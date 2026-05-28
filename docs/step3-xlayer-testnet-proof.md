# Step 3 完成记录：xLayer 测试网真实链路与证据

日期：2026-05-28

## 已执行命令

```bash
npm run deploy:v4:xlayer-testnet
```

## 关键结果

- Network: `xlayerTestnet`
- Chain ID: `1952`
- Deployer: `0x6a20340b51Db6869EF80b44484c5C364d13B2397`

### 合约地址

- `V4PoolManager`: `0x0A0666FE4380B6EB6178154d6886DA42f16403F6`
- `AgentQuoteRegistry`: `0x4373f104FCA40182c11E1cC9706c65Eb2d977Ea0`
- `DeterministicCreate2Factory`: `0x78c733699B6aF952f17eC77de6C50060dEeda5c4`
- `ArenaV4Hook`: `0xe62C4900Fc03fB6aDeA62e51281c260af14080C0`
- `V4FlowExecutor`: `0xaa3a1A3Cf778125A76Af97123dd33878D4F5731a`
- `Token0`: `0x8A2B35CC4CDF88d9d8Bd55989C33a1094eee8a6f`
- `Token1`: `0xD79eDa87703CeF235d7BAC428DDEF3E4d360cd45`

### Hook 权限位证据（CREATE2 挖盐）

- 目标低 14 位：`0xC0`（beforeSwap + afterSwap）
- 实际低 14 位：`0xc0`
- Salt: `0x0000000000000000000000000000000000000000000000000000000000003d22`
- 挖盐次数：`15651`

### 交易哈希证据

- `initialize`: `0x9afb6b3e2a081ea48b8e43874096b6f34343b593e8f25e5335145de615211f1e`
- `addLiquidity`: `0x39fd7ab784055de91c7ed855e9fbc9ee0bde6563d11fa4ca1d6a3d4ae9eea27a`
- `swap`: `0x159e6be933549579925a4d4c4b652a31f9cd4f895fe856c0b7efbc186c9d9081`

### Hook 事件结果（来自 swap tx）

- `QuoteWindowOpened`: true
- `QuoteSubmitted`: true
- `QuoteSelected`:
  - `agent`: `0x6a20340b51Db6869EF80b44484c5C364d13B2397`
  - `amountOut`: `5200`
- `SwapQualityRecorded`:
  - `baselineAmountOut`: `4960`
  - `finalAmountOut`: `5200`
  - `improvementBps`: `483`
  - `quoteCount`: `1`
  - `latencySeconds`: `0`
  - `usedFallback`: `false`

## 输出文件

- 部署证明 JSON：
  - `deployments/v4-xlayerTestnet-1952-2026-05-27T22-24-42-628Z.json`
  - `deployments/v4-xlayerTestnet-latest.json`
- 提交草稿：
  - `submissions/submission-v4-xlayerTestnet-2026-05-27T22-29-54-702Z.md`

## 当前阻塞（仅验证）

执行 `npm run verify:v4:xlayer-testnet` 时出现网络层错误：

- `read ECONNRESET`

说明是验证请求链路不稳定，不是部署或合约逻辑失败。建议间隔一段时间后重试验证命令。
