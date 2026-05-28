// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentQuoteRegistry.sol";

contract ArenaHook {
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

    constructor(address registryAddress, uint256 directSettleThreshold_) {
        require(registryAddress != address(0), "ArenaHook: invalid registry");
        registry = AgentQuoteRegistry(registryAddress);
        directSettleThreshold = directSettleThreshold_;
    }

    function computeRequestId(address sender, uint256 blockNumber, uint256 amountIn) public pure returns (bytes32) {
        return keccak256(abi.encode(sender, blockNumber, amountIn));
    }

    function quoteMessageHash(
        bytes32 requestId,
        uint256 amountOut,
        uint64 validUntil,
        uint256 nonce
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), block.chainid, requestId, amountOut, validUntil, nonce));
    }

    function openQuoteWindow(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 windowSeconds
    ) external returns (bytes32 requestId) {
        require(windowSeconds > 0, "ArenaHook: invalid window");

        requestId = computeRequestId(msg.sender, block.number, amountIn);
        uint64 quoteDeadline = uint64(block.timestamp + windowSeconds);

        requests[requestId] = SwapRequest({
            sender: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            quoteDeadline: quoteDeadline,
            openedAt: uint64(block.timestamp),
            settled: false
        });

        emit QuoteWindowOpened(requestId, msg.sender, tokenIn, tokenOut, amountIn, quoteDeadline);
    }

    function submitQuote(
        bytes32 requestId,
        address agent,
        uint256 amountOut,
        uint64 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(registry.whitelistedAgents(agent), "ArenaHook: agent not whitelisted");

        SwapRequest storage request = requests[requestId];
        require(request.sender != address(0), "ArenaHook: request not found");
        require(block.timestamp <= request.quoteDeadline, "ArenaHook: quote window closed");
        require(validUntil >= block.timestamp, "ArenaHook: quote expired");
        require(nonce == agentNonces[agent], "ArenaHook: invalid nonce");
        require(
            _isValidSignature(agent, quoteMessageHash(requestId, amountOut, validUntil, nonce), signature),
            "ArenaHook: invalid signature"
        );

        agentNonces[agent] += 1;

        registry.recordSubmission(agent);
        quoteCounts[requestId] += 1;

        Quote storage current = bestQuotes[requestId];
        if (current.agent == address(0) || amountOut > current.amountOut) {
            bestQuotes[requestId] = Quote({agent: agent, amountOut: amountOut, validUntil: validUntil});
        }

        emit QuoteSubmitted(requestId, agent, amountOut, validUntil);
    }

    function settleRequest(bytes32 requestId, uint256 baselineAmountOut, uint256 gasUsed) external {
        SwapRequest storage request = requests[requestId];
        require(request.sender != address(0), "ArenaHook: request not found");
        require(!request.settled, "ArenaHook: already settled");

        request.settled = true;

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
            gasUsed,
            quoteCount,
            latencySeconds,
            usedFallback
        );
    }

    function _computeImprovementBps(uint256 baselineAmountOut, uint256 finalAmountOut) internal pure returns (int256) {
        if (baselineAmountOut == 0) {
            return 0;
        }
        int256 diff = int256(finalAmountOut) - int256(baselineAmountOut);
        return (diff * 10000) / int256(baselineAmountOut);
    }

    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) internal pure returns (bool) {
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

    function _splitSignature(bytes calldata signature) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        if (signature.length != 65) {
            revert("ArenaHook: invalid signature length");
        }

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
    }
}
