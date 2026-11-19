import {
  getAccount,
  getPublicClient,
  readContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { BaseError, ContractFunctionRevertedError, erc20Abi, parseEventLogs, type Address, type Hash, type TransactionReceipt } from 'viem'
import { arcTestnet } from 'viem/chains'
import { config } from '@/config'
import { buildAddressExplorerUrl, buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { salaryxAbi } from '@/contracts/salaryx'

export const CHAIN_ID = arcTestnet.id
const envAddress = import.meta.env.VITE_PAYROLL_CONTRACT as string | undefined
export const PAYROLL_ADDRESS = (envAddress && /^0x[0-9a-fA-F]{40}$/.test(envAddress) ? envAddress : undefined) as Address | undefined
export const USDC_ADDRESS = getUsdc(CHAIN_ID)?.address as Address

export const txUrl = (hash: string) => buildTxExplorerUrl(CHAIN_ID, hash)
export const addressUrl = (a: string) => buildAddressExplorerUrl(CHAIN_ID, a)

export const STATUS = { None: 0, Created: 1, Executed: 2, Cancelled: 3 } as const

function contractAddress(): Address {
  if (!PAYROLL_ADDRESS) throw new Error('The payroll contract address is not configured (VITE_PAYROLL_CONTRACT).')
  return PAYROLL_ADDRESS
}

export function isUserRejection(e: unknown): boolean {
  const m = (e as { message?: string })?.message?.toLowerCase() ?? ''
  return (e as { code?: number })?.code === 4001 || m.includes('user rejected') || m.includes('user denied')
}

const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

export function describeError(e: unknown): string {
  if (isUserRejection(e)) return 'Transaction cancelled in your wallet.'
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      return `The contract rejected this action: ${words(reverted.data?.errorName ?? reverted.shortMessage)}.`
    }
    const m = e.shortMessage.toLowerCase()
    if (m.includes('insufficient funds')) return 'Not enough USDC for gas. Use "Get test USDC" in the sidebar.'
    return e.shortMessage
  }
  return (e as Error)?.message ?? 'Something went wrong.'
}

/** Connect-check, then make sure the wallet is on Arc Testnet. */
export async function ensureWallet(): Promise<Address> {
  const acct = getAccount(config)
  if (!acct.isConnected || !acct.address) throw new Error('Connect your wallet first.')
  if (acct.chainId !== CHAIN_ID) await switchChain(config, { chainId: CHAIN_ID })
  return acct.address
}

type OnHash = (hash: Hash) => void

async function finish(hash: Hash, onHash: OnHash): Promise<TransactionReceipt> {
  onHash(hash)
  return waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID })
}

// ---------- writes (each returns the confirmed receipt; callers verify the logs) ----------

export async function opRegisterCompany(companyId: Hash, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'registerCompany', args: [companyId], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opDeposit(companyId: Hash, amount: bigint, onHash: OnHash) {
  const account = await ensureWallet()
  const allowance = await readContract(config, { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [account, contractAddress()], chainId: CHAIN_ID })
  if (allowance < amount) {
    const approveHash = await writeContract(config, { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [contractAddress(), amount], chainId: CHAIN_ID })
    const r = await waitForTransactionReceipt(config, { hash: approveHash, chainId: CHAIN_ID })
    if (r.status !== 'success') throw new Error('The USDC approval failed.')
  }
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'depositBudget', args: [companyId, amount], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opWithdraw(companyId: Hash, to: Address, amount: bigint, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'withdrawBudget', args: [companyId, to, amount], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opSetAllowance(companyId: Hash, amount: bigint, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'setMonthlyAllowance', args: [companyId, amount], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opSetManager(companyId: Hash, manager: Address, enabled: boolean, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'setManager', args: [companyId, manager, enabled], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opSetExecutor(companyId: Hash, executor: Address, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'setExecutor', args: [companyId, executor], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opCreateBatch(
  companyId: Hash,
  ref: Hash,
  executeAfterSec: bigint,
  recipients: Address[],
  amounts: bigint[],
  onHash: OnHash,
) {
  await ensureWallet()
  const hash = await writeContract(config, {
    address: contractAddress(),
    abi: salaryxAbi,
    functionName: 'createBatch',
    args: [companyId, ref, executeAfterSec, recipients, amounts],
    chainId: CHAIN_ID,
  })
  return finish(hash, onHash)
}

export async function opExecuteBatch(batchId: bigint, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'executeBatch', args: [batchId], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

export async function opCancelBatch(batchId: bigint, onHash: OnHash) {
  await ensureWallet()
  const hash = await writeContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'cancelBatch', args: [batchId], chainId: CHAIN_ID })
  return finish(hash, onHash)
}

// ---------- log verification ----------

const ours = (log: { address: string }) => log.address.toLowerCase() === PAYROLL_ADDRESS?.toLowerCase()

/** Returns an error string when the receipt does not prove the expected effect. */
export type Verifier = (r: TransactionReceipt) => string | undefined

export const verifyRegister = (companyId: Hash): Verifier => (r) => {
  const logs = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'CompanyRegistered' }).filter(ours)
  return logs.some((l) => l.args.companyId === companyId) ? undefined : 'CompanyRegistered event not found in receipt.'
}

export const verifyDeposit = (companyId: Hash, amount: bigint): Verifier => (r) => {
  const logs = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'BudgetDeposited' }).filter(ours)
  return logs.some((l) => l.args.companyId === companyId && l.args.amount === amount) ? undefined : 'Deposit event does not match the requested amount.'
}

export const verifyEvent =
  (eventName: 'BudgetWithdrawn' | 'MonthlyAllowanceSet' | 'ManagerSet' | 'ExecutorSet' | 'BatchCancelled'): Verifier =>
  (r) => {
    const logs = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName }).filter(ours)
    return logs.length ? undefined : `${eventName} event not found in receipt.`
  }

export const verifyCreate = (companyId: Hash, total: bigint, count: number): Verifier => (r) => {
  const created = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'BatchCreated' }).filter(ours)
  const hit = created.find((l) => l.args.companyId === companyId)
  if (!hit) return 'BatchCreated event not found in receipt.'
  if (hit.args.total !== total || hit.args.count !== count) return 'Batch totals on-chain differ from the reviewed payroll.'
  return undefined
}

export function batchIdFromReceipt(r: TransactionReceipt, companyId: Hash): bigint | undefined {
  const created = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'BatchCreated' }).filter(ours)
  return created.find((l) => l.args.companyId === companyId)?.args.batchId
}

export const verifyExecute = (batchId: bigint, expected: { recipient: string; amount: bigint }[]): Verifier => (r) => {
  const done = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'BatchExecuted' }).filter(ours)
  if (!done.some((l) => l.args.batchId === batchId)) return 'BatchExecuted event not found in receipt.'
  const paid = parseEventLogs({ abi: salaryxAbi, logs: r.logs, eventName: 'SalaryPaid' }).filter((l) => ours(l) && l.args.batchId === batchId)
  if (paid.length !== expected.length) return `Expected ${expected.length} payments but found ${paid.length}.`
  const left = [...expected]
  for (const p of paid) {
    const i = left.findIndex((e) => e.recipient.toLowerCase() === p.args.recipient.toLowerCase() && e.amount === p.args.amount)
    if (i < 0) return 'A payment in the receipt does not match the approved payroll.'
    left.splice(i, 1)
  }
  return undefined
}

// ---------- reads ----------

export async function readCompany(companyId: Hash) {
  return readContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'getCompany', args: [companyId], chainId: CHAIN_ID })
}

export async function readBatch(batchId: bigint) {
  return readContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'getBatch', args: [batchId], chainId: CHAIN_ID })
}

export async function readBatchPayments(batchId: bigint) {
  return readContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'getBatchPayments', args: [batchId], chainId: CHAIN_ID })
}

export async function readUsdcBalance(account: Address) {
  return readContract(config, { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account], chainId: CHAIN_ID })
}

export async function readIsManager(companyId: Hash, account: Address) {
  return readContract(config, { address: contractAddress(), abi: salaryxAbi, functionName: 'isManager', args: [companyId, account], chainId: CHAIN_ID })
}

/** Best effort: find the BatchExecuted transaction. Returns undefined if the RPC refuses the range. */
export async function findExecutionTx(batchId: bigint, fromBlock?: bigint): Promise<{ hash: Hash; blockNumber: bigint } | undefined> {
  try {
    const client = getPublicClient(config, { chainId: CHAIN_ID })
    if (!client) return undefined
    const logs = await client.getContractEvents({
      address: contractAddress(),
      abi: salaryxAbi,
      eventName: 'BatchExecuted',
      args: { batchId },
      fromBlock: fromBlock ?? 'earliest',
      toBlock: 'latest',
    })
    const l = logs[0]
    return l ? { hash: l.transactionHash, blockNumber: l.blockNumber } : undefined
  } catch {
    return undefined
  }
}
