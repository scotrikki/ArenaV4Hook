// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import "./AgentQuoteRegistry.sol";

contract ArenaV4Hook is BaseHook {
    using BalanceDeltaLibrary for BalanceDelta;

    struct SwapRequest {
        address sender;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint64 quoteDeadline;
        uint64 openedAt;
        bool settled;
    }

    struct Quote {
        address agent;
        uint256 amountOut;
        uint64 validUntil;
    }

    struct HookQuoteData {
        address user;
        address agent;
        uint256 amountOut;
        uint256 minAmountOut;
        uint64 quoteDeadline;
        uint64 validUntil;
        uint256 nonce;
        bytes32 requestSalt;
        bytes signature;
    }

    struct LegacyHookQuoteData {
        address user;
        address agent;
        uint256 amountOut;
        uint256 minAmountOut;
        uint64 quoteDeadline;
        uint64 validUntil;
        uint256 nonce;
        bytes signature;
    }

    enum QuoteRejectReason {
        None,
        EmptyQuote,
        AgentNotWhitelisted,
        RequestNotFound,
        RequestAlreadySettled,
        QuoteWindowClosed,
        QuoteExpired,
        InvalidNonce,
        InvalidSignature
    }

    AgentQuoteRegistry public immutable registry;
    uint256 public immutable directSettleThreshold;

    mapping(bytes32 => SwapRequest) public requests;
    mapping(bytes32 => Quote) public bestQuotes;
    mapping(bytes32 => uint256) public quoteCounts;
    mapping(address => uint256) public agentNonces;

    event QuoteWindowOpened(
        bytes32 indexed requestId,
        address indexed sender,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint64 quoteDeadline
    );

    event QuoteSubmitted(
        bytes32 indexed requestId,
        address indexed agent,
        uint256 amountOut,
        uint64 validUntil
    );

    event QuoteRejected(
        bytes32 indexed requestId,
        address indexed agent,
        uint8 reason,
        uint256 providedNonce,
        uint256 expectedNonce
    );

    event QuoteSelected(
        bytes32 indexed requestId,
        address indexed agent,
        uint256 amountOut
    );

    event SwapQualityRecorded(
        bytes32 indexed requestId,
        uint256 baselineAmountOut,
        uint256 finalAmountOut,
        int256 improvementBps,
        uint256 gasUsed,
        uint256 quoteCount,
        uint256 latencySeconds,
        bool usedFallback
    );

    constructor(IPoolManager manager, address registryAddress, uint256 directSettleThreshold_)
        BaseHook(manager)
    {
        require(registryAddress != address(0), "ArenaV4Hook: invalid registry");
        registry = AgentQuoteRegistry(registryAddress);
        directSettleThreshold = directSettleThreshold_;
    }

    // Temporary no-op for local/dev deployments.
    // Production deployment should use HookMiner and keep the default validation.
    function validateHookAddress(BaseHook) internal pure override {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function computeRequestId(address sender, uint256 amountIn, address tokenIn, address tokenOut, bool zeroForOne)
        public
        pure
        returns (bytes32)
    {
        return computeRequestIdWithSalt(sender, amountIn, tokenIn, tokenOut, zeroForOne, bytes32(0));
    }

    function computeRequestIdWithSalt(
        address sender,
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        bool zeroForOne,
        bytes32 requestSalt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(sender, amountIn, tokenIn, tokenOut, zeroForOne, requestSalt));
    }

    function quoteMessageHash(bytes32 requestId, uint256 amountOut, uint64 validUntil, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(address(this), block.chainid, requestId, amountOut, validUntil, nonce));
    }

    function decodeHookData(bytes calldata hookData) external pure returns (HookQuoteData memory quoteData) {
        quoteData = abi.decode(hookData, (HookQuoteData));
    }

    function decodeLegacyHookData(bytes calldata hookData)
        external
        pure
        returns (LegacyHookQuoteData memory quoteData)
    {
        quoteData = abi.decode(hookData, (LegacyHookQuoteData));
    }

    function submitQuote(
        bytes32 requestId,
        address agent,
        uint256 amountOut,
        uint64 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external {
        HookQuoteData memory quoteData = HookQuoteData({
            user: address(0),
            agent: agent,
            amountOut: amountOut,
            minAmountOut: 0,
            quoteDeadline: 0,
            validUntil: validUntil,
            nonce: nonce,
            requestSalt: bytes32(0),
            signature: signature
        });

        _trySubmitQuote(requestId, quoteData);
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        HookQuoteData memory quoteData;
        bool hasQuoteData;
        (quoteData, hasQuoteData) = _tryDecodeHookData(hookData);

        bytes32 requestId = _openRequestFromSwap(sender, key, params, quoteData, hasQuoteData);

        if (hasQuoteData) {
            _trySubmitQuote(requestId, quoteData);
        }

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        bytes32 requestId = _resolveRequestId(sender, key, params, hookData);
        if (requestId == bytes32(0)) {
            return (BaseHook.afterSwap.selector, 0);
        }

        SwapRequest storage request = requests[requestId];
        if (request.settled) {
            return (BaseHook.afterSwap.selector, 0);
        }

        request.settled = true;

        uint256 baselineAmountOut = _baselineAmountOut(params, delta);
        uint256 finalAmountOut = baselineAmountOut;
        address selectedAgent = address(0);
        bool usedFallback = true;

        if (request.amountIn >= directSettleThreshold) {
            Quote memory best = bestQuotes[requestId];
            bool quoteIsUsable = best.agent != address(0) && best.validUntil >= block.timestamp;
            if (quoteIsUsable && best.amountOut >= request.minAmountOut) {
                finalAmountOut = best.amountOut;
                selectedAgent = best.agent;
                usedFallback = false;
            }
        }

        int256 improvementBps = _computeImprovementBps(baselineAmountOut, finalAmountOut);
        uint256 latencySeconds = usedFallback ? 0 : block.timestamp - request.openedAt;
        uint256 quoteCount = usedFallback ? 0 : quoteCounts[requestId];

        if (selectedAgent != address(0)) {
            registry.recordWin(selectedAgent, improvementBps);
        }

        emit QuoteSelected(requestId, selectedAgent, finalAmountOut);
        emit SwapQualityRecorded(
            requestId,
            baselineAmountOut,
            finalAmountOut,
            improvementBps,
            0,
            quoteCount,
            latencySeconds,
            usedFallback
        );

        return (BaseHook.afterSwap.selector, 0);
    }

    function _resolveRequestId(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        returns (bytes32)
    {
        (address requestUser, bytes32 requestSalt) = _resolveRequestContext(sender, hookData);
        (address tokenIn, address tokenOut) = _resolveTokens(key, params.zeroForOne);
        uint256 amountIn = _abs(params.amountSpecified);
        bytes32 requestId =
            computeRequestIdWithSalt(requestUser, amountIn, tokenIn, tokenOut, params.zeroForOne, requestSalt);
        if (requests[requestId].sender == address(0)) {
            return bytes32(0);
        }
        return requestId;
    }

    function _trySubmitQuote(bytes32 requestId, HookQuoteData memory quoteData) internal {
        if (quoteData.agent == address(0) || quoteData.amountOut == 0) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.EmptyQuote, quoteData.nonce, 0);
            return;
        }
        if (!registry.whitelistedAgents(quoteData.agent)) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.AgentNotWhitelisted, quoteData.nonce, 0);
            return;
        }

        SwapRequest storage request = requests[requestId];
        if (request.sender == address(0)) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.RequestNotFound, quoteData.nonce, 0);
            return;
        }
        if (request.settled) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.RequestAlreadySettled, quoteData.nonce, 0);
            return;
        }
        if (block.timestamp > request.quoteDeadline) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.QuoteWindowClosed, quoteData.nonce, 0);
            return;
        }
        if (quoteData.validUntil < block.timestamp) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.QuoteExpired, quoteData.nonce, 0);
            return;
        }

        uint256 expectedNonce = agentNonces[quoteData.agent];
        if (quoteData.nonce != expectedNonce) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.InvalidNonce, quoteData.nonce, expectedNonce);
            return;
        }

        if (
            !_isValidSignature(
                quoteData.agent,
                quoteMessageHash(requestId, quoteData.amountOut, quoteData.validUntil, quoteData.nonce),
                quoteData.signature
            )
        ) {
            _rejectQuote(requestId, quoteData.agent, QuoteRejectReason.InvalidSignature, quoteData.nonce, expectedNonce);
            return;
        }

        agentNonces[quoteData.agent] = expectedNonce + 1;
        registry.recordSubmission(quoteData.agent);
        quoteCounts[requestId] += 1;

        Quote storage current = bestQuotes[requestId];
        if (current.agent == address(0) || quoteData.amountOut > current.amountOut) {
            bestQuotes[requestId] =
                Quote({agent: quoteData.agent, amountOut: quoteData.amountOut, validUntil: quoteData.validUntil});
        }

        emit QuoteSubmitted(requestId, quoteData.agent, quoteData.amountOut, quoteData.validUntil);
    }

    function _resolveRequestContext(address sender, bytes calldata hookData)
        internal
        view
        returns (address requestUser, bytes32 requestSalt)
    {
        requestUser = sender;

        HookQuoteData memory quoteData;
        bool hasQuoteData;
        (quoteData, hasQuoteData) = _tryDecodeHookData(hookData);
        if (hasQuoteData) {
            if (quoteData.user != address(0)) {
                requestUser = quoteData.user;
            }
            requestSalt = quoteData.requestSalt;
        }
    }

    function _resolveTokens(PoolKey calldata key, bool zeroForOne) internal pure returns (address tokenIn, address tokenOut) {
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        if (zeroForOne) {
            return (token0, token1);
        }
        return (token1, token0);
    }

    function _baselineAmountOut(SwapParams calldata params, BalanceDelta delta) internal pure returns (uint256) {
        int128 outputSigned = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (outputSigned <= 0) {
            return 0;
        }
        return uint256(uint128(outputSigned));
    }

    function _openRequestFromSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        HookQuoteData memory quoteData,
        bool hasQuoteData
    ) internal returns (bytes32 requestId) {
        address requestUser = sender;
        if (hasQuoteData && quoteData.user != address(0)) {
            requestUser = quoteData.user;
        }
        bytes32 requestSalt = hasQuoteData ? quoteData.requestSalt : bytes32(0);

        (address tokenIn, address tokenOut) = _resolveTokens(key, params.zeroForOne);
        uint256 amountIn = _abs(params.amountSpecified);

        uint64 quoteDeadline = uint64(block.timestamp);
        uint256 minAmountOut = 0;
        if (hasQuoteData) {
            quoteDeadline = quoteData.quoteDeadline;
            minAmountOut = quoteData.minAmountOut;
        }

        requestId = computeRequestIdWithSalt(requestUser, amountIn, tokenIn, tokenOut, params.zeroForOne, requestSalt);
        requests[requestId] = SwapRequest({
            sender: requestUser,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            quoteDeadline: quoteDeadline,
            openedAt: uint64(block.timestamp),
            settled: false
        });

        emit QuoteWindowOpened(requestId, requestUser, tokenIn, tokenOut, amountIn, quoteDeadline);
    }

    function _tryDecodeHookData(bytes calldata hookData) internal view returns (HookQuoteData memory quoteData, bool ok) {
        if (hookData.length == 0) {
            return (quoteData, false);
        }

        try this.decodeHookData(hookData) returns (HookQuoteData memory decoded) {
            return (decoded, true);
        } catch {
            try this.decodeLegacyHookData(hookData) returns (LegacyHookQuoteData memory legacyDecoded) {
                return (_upgradeLegacyHookData(legacyDecoded), true);
            } catch {
                return (quoteData, false);
            }
        }
    }

    function _upgradeLegacyHookData(LegacyHookQuoteData memory legacyData)
        internal
        pure
        returns (HookQuoteData memory quoteData)
    {
        quoteData = HookQuoteData({
            user: legacyData.user,
            agent: legacyData.agent,
            amountOut: legacyData.amountOut,
            minAmountOut: legacyData.minAmountOut,
            quoteDeadline: legacyData.quoteDeadline,
            validUntil: legacyData.validUntil,
            nonce: legacyData.nonce,
            requestSalt: bytes32(0),
            signature: legacyData.signature
        });
    }

    function _rejectQuote(
        bytes32 requestId,
        address agent,
        QuoteRejectReason reason,
        uint256 providedNonce,
        uint256 expectedNonce
    ) internal {
        emit QuoteRejected(requestId, agent, uint8(reason), providedNonce, expectedNonce);
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return uint256(value >= 0 ? value : -value);
    }

    function _computeImprovementBps(uint256 baselineAmountOut, uint256 finalAmountOut) internal pure returns (int256) {
        if (baselineAmountOut == 0) {
            return 0;
        }
        int256 diff = int256(finalAmountOut) - int256(baselineAmountOut);
        return (diff * 10000) / int256(baselineAmountOut);
    }

    function _isValidSignature(address signer, bytes32 digest, bytes memory signature) internal pure returns (bool) {
        if (signature.length != 65) {
            return false;
        }

        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            return false;
        }

        bytes32 secp256k1nHalf = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
        if (uint256(s) > uint256(secp256k1nHalf)) {
            return false;
        }

        return ecrecover(ethDigest, v, r, s) == signer;
    }

    function _splitSignature(bytes memory signature) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
    }
}
