# PancakeSwap Triangular Arbitrage Bot

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Framework: Next.js (auto-detected)
4. Click Deploy

## How It Works

- Connects to your MetaMask wallet (BSC Mainnet)
- Scans 6 triangular arbitrage paths every 4 seconds
- Shows real-time profit/loss estimates after gas costs
- Manual or auto-execute mode

## Setup

```bash
npm install
npm run dev     # local dev
npm run build   # production build
```

## Risk Warning

DeFi arbitrage is risky. MEV bots can front-run your transactions.
Always test with small amounts first. Never trade what you can't afford to lose.

## Paths Scanned

- BNB → BUSD → USDT → BNB
- BNB → USDT → BUSD → BNB
- BNB → CAKE → BUSD → BNB
- BNB → ETH → BUSD → BNB
- BNB → BTCB → BUSD → BNB
- BNB → BUSD → CAKE → BNB
