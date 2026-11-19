/**
 * SalaryX keeper: releases payroll batches that are due.
 *
 * Run it on your own server or cron, NOT in the browser:
 *   KEEPER_PRIVATE_KEY=0x... VITE_PAYROLL_CONTRACT=0x... bun run keeper            (one pass)
 *   KEEPER_PRIVATE_KEY=0x... VITE_PAYROLL_CONTRACT=0x... bun run keeper -- --watch (every 60s)
 *
 * The keeper wallet must be set as the company's executor (Budget & payments page). The contract only
 * lets it execute batches that a manager already created, after their pay date. It cannot create
 * batches, change recipients or amounts, or withdraw funds. Fund it with a little USDC for gas.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, isAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { salaryxAbi } from '../src/contracts/salaryx'
import { requireChain } from '../src/onchain-facts'

const STATE_FILE = process.env.KEEPER_STATE_FILE ?? '.keeper-state.json'
const WATCH = process.argv.includes('--watch')
const INTERVAL_MS = 60_000
const STATUS_CREATED = 1

function fail(message: string): never {
  console.error(`keeper: ${message}`)
  process.exit(1)
}

const key = process.env.KEEPER_PRIVATE_KEY
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('KEEPER_PRIVATE_KEY is missing or not a 32-byte hex key.')
const contract = process.env.VITE_PAYROLL_CONTRACT
if (!contract || !isAddress(contract)) fail('VITE_PAYROLL_CONTRACT is missing or invalid.')

// Prefer a dedicated RPC. Falls back to the public Arc Testnet RPC from the facts module.
const rpcUrl = process.env.RPC_URL_Arc_Testnet ?? process.env.ARC_TESTNET_RPC_URL ?? requireChain(arcTestnet.id).rpcUrls[0]
const account = privateKeyToAccount(key as `0x${string}`)
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })
const address = contract

const loadCursor = (): bigint => {
  try {
    return existsSync(STATE_FILE) ? BigInt((JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { cursor: string }).cursor) : 1n
  } catch {
    return 1n
  }
}
const saveCursor = (c: bigint) => writeFileSync(STATE_FILE, JSON.stringify({ cursor: c.toString() }))

async function pass() {
  const next = await publicClient.readContract({ address, abi: salaryxAbi, functionName: 'nextBatchId' })
  const last = next - 1n
  let cursor = loadCursor()
  let contiguous = true
  const now = BigInt(Math.floor(Date.now() / 1000))
  console.log(`keeper ${account.address}: checking batches ${cursor}..${last}`)

  for (let id = cursor; id <= last; id++) {
    try {
      const batch = await publicClient.readContract({ address, abi: salaryxAbi, functionName: 'getBatch', args: [id] })
      if (batch.status !== STATUS_CREATED) {
        if (contiguous) cursor = id + 1n
        continue
      }
      contiguous = false
      if (batch.executeAfter > now) continue

      const company = await publicClient.readContract({ address, abi: salaryxAbi, functionName: 'getCompany', args: [batch.companyId] })
      if (company.executor.toLowerCase() !== account.address.toLowerCase()) {
        console.log(`  batch ${id}: this wallet is not the company executor, skipping`)
        continue
      }
      if (!company.active) {
        console.log(`  batch ${id}: company is suspended, skipping`)
        continue
      }
      // Simulate first so a revert (for example a blocklisted recipient) costs no gas.
      const { request } = await publicClient.simulateContract({ address, abi: salaryxAbi, functionName: 'executeBatch', args: [id], account })
      const hash = await wallet.writeContract(request)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      console.log(`  batch ${id}: ${receipt.status} ${hash}`)
    } catch (e) {
      console.error(`  batch ${id}: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  saveCursor(cursor)
}

if (WATCH) {
  console.log(`keeper watching every ${INTERVAL_MS / 1000}s. Press Ctrl+C to stop.`)
  for (;;) {
    await pass().catch((e) => console.error(`pass failed: ${(e as Error).message.split('\n')[0]}`))
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
} else {
  await pass()
}
