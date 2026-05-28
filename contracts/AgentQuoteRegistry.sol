// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentQuoteRegistry {
    struct AgentStats {
        uint256 submissions;
        uint256 wins;
        uint256 cumulativePositiveImprovementBps;
    }

    address public owner;
    address public hook;

    mapping(address => bool) public whitelistedAgents;
    mapping(address => AgentStats) public agentStats;

    event HookUpdated(address indexed hook);
    event AgentWhitelistUpdated(address indexed agent, bool isWhitelisted);
    event AgentSubmissionRecorded(address indexed agent, uint256 submissions);
    event AgentWinRecorded(address indexed agent, uint256 wins, int256 improvementBps);

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentQuoteRegistry: only owner");
        _;
    }

    modifier onlyHook() {
        require(msg.sender == hook, "AgentQuoteRegistry: only hook");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "AgentQuoteRegistry: invalid owner");
        owner = owner_;
    }

    function setHook(address hook_) external onlyOwner {
        require(hook_ != address(0), "AgentQuoteRegistry: invalid hook");
        hook = hook_;
        emit HookUpdated(hook_);
    }

    function setAgentWhitelist(address agent, bool isWhitelisted) external onlyOwner {
        require(agent != address(0), "AgentQuoteRegistry: invalid agent");
        whitelistedAgents[agent] = isWhitelisted;
        emit AgentWhitelistUpdated(agent, isWhitelisted);
    }

    function isAgentWhitelisted(address agent) external view returns (bool) {
        return whitelistedAgents[agent];
    }

    function recordSubmission(address agent) external onlyHook {
        AgentStats storage stats = agentStats[agent];
        stats.submissions += 1;
        emit AgentSubmissionRecorded(agent, stats.submissions);
    }

    function recordWin(address agent, int256 improvementBps) external onlyHook {
        AgentStats storage stats = agentStats[agent];
        stats.wins += 1;
        if (improvementBps > 0) {
            stats.cumulativePositiveImprovementBps += uint256(improvementBps);
        }
        emit AgentWinRecorded(agent, stats.wins, improvementBps);
    }

    function getAgentWinRateBps(address agent) external view returns (uint256) {
        AgentStats memory stats = agentStats[agent];
        if (stats.submissions == 0) {
            return 0;
        }
        return (stats.wins * 10000) / stats.submissions;
    }
}
