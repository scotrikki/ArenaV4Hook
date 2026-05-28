// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DeterministicCreate2Factory {
    event Deployed(address indexed addr, bytes32 indexed salt);

    error EmptyBytecode();
    error DeploymentFailed();

    function deploy(bytes32 salt, bytes memory creationCode) external returns (address addr) {
        if (creationCode.length == 0) revert EmptyBytecode();
        assembly {
            addr := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        if (addr == address(0)) revert DeploymentFailed();
        emit Deployed(addr, salt);
    }
}
