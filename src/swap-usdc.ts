
import {  SwapService } from '@catalyst-team/poly-sdk';

// const onchain = new OnchainService({
//   privateKey: process.env.POLYMARKET_PRIVATE_KEY!,
//   rpcUrl: 'https://polygon-rpc.com', // 可选
// });


// ===== CTF 操作 =====

// Split: USDC -> YES + NO 代币
// const splitResult = await onchain.split(conditionId, '100');

// Merge: YES + NO -> USDC（用于套利）
// const mergeResult = await onchain.mergeByTokenIds(conditionId, tokenIds, '100');

// Redeem: 获胜代币 -> USDC（结算后）
// const redeemResult = await onchain.redeemByTokenIds(conditionId, tokenIds);

// ===== DEX 交换 (QuickSwap V3) =====

// 将 USDC 交换为 USDC.e（CTF 需要）
const a = await SwapService.getWalletBalances("0x07D12286F943ccFE95eB1335Be96B4eD003da835")
console.log(a)
