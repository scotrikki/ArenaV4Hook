// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

contract TestERC20Mintable is IERC20Minimal {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(uint256 amountToMint) {
        mint(msg.sender, amountToMint);
    }

    function mint(address to, uint256 amount) public {
        uint256 next = balanceOf[to] + amount;
        require(next >= amount, "overflow");
        balanceOf[to] = next;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        uint256 fromBalance = balanceOf[msg.sender];
        require(fromBalance >= amount, "insufficient");
        balanceOf[msg.sender] = fromBalance - amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[sender][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[sender][msg.sender] = allowed - amount;

        uint256 fromBalance = balanceOf[sender];
        require(fromBalance >= amount, "insufficient");
        balanceOf[sender] = fromBalance - amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }
}
