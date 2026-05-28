// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

contract V4FlowExecutor is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager;

    error InsufficientBalance(address token, uint256 balance, uint256 required);

    struct CallbackData {
        uint8 action; // 1: modifyLiquidity, 2: swap
        address sender;
        PoolKey key;
        ModifyLiquidityParams modifyParams;
        SwapParams swapParams;
        bytes hookData;
    }

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes memory hookData)
        external
        returns (BalanceDelta delta, BalanceDelta feesAccrued)
    {
        bytes memory result = manager.unlock(
            abi.encode(CallbackData(1, msg.sender, key, params, SwapParams(false, 0, 0), hookData))
        );
        (delta, feesAccrued) = abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes memory hookData)
        external
        returns (BalanceDelta delta)
    {
        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData(
                    2,
                    msg.sender,
                    key,
                    ModifyLiquidityParams({tickLower: 0, tickUpper: 0, liquidityDelta: 0, salt: bytes32(0)}),
                    params,
                    hookData
                )
            )
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(manager), "V4FlowExecutor: only manager");

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        if (data.action == 1) {
            (BalanceDelta delta, BalanceDelta feesAccrued) =
                manager.modifyLiquidity(data.key, data.modifyParams, data.hookData);
            _settleByDelta(data.key.currency0, data.key.currency1);
            return abi.encode(delta, feesAccrued);
        }

        if (data.action == 2) {
            BalanceDelta delta = manager.swap(data.key, data.swapParams, data.hookData);
            _settleByDelta(data.key.currency0, data.key.currency1);
            return abi.encode(delta);
        }

        revert("V4FlowExecutor: invalid action");
    }

    function _settleByDelta(Currency currency0, Currency currency1) internal {
        int256 delta0 = manager.currencyDelta(address(this), currency0);
        int256 delta1 = manager.currencyDelta(address(this), currency1);

        if (delta0 < 0) {
            _payCurrency(currency0, uint256(-delta0));
        } else if (delta0 > 0) {
            manager.take(currency0, address(this), uint256(delta0));
        }

        if (delta1 < 0) {
            _payCurrency(currency1, uint256(-delta1));
        } else if (delta1 > 0) {
            manager.take(currency1, address(this), uint256(delta1));
        }
    }

    function _payCurrency(Currency currency, uint256 amount) internal {
        if (currency.isAddressZero()) {
            manager.settle{value: amount}();
            return;
        }

        uint256 bal = IERC20Minimal(Currency.unwrap(currency)).balanceOf(address(this));
        if (bal < amount) {
            revert InsufficientBalance(Currency.unwrap(currency), bal, amount);
        }
        manager.sync(currency);
        IERC20Minimal(Currency.unwrap(currency)).transfer(address(manager), amount);
        manager.settle();
    }
}
