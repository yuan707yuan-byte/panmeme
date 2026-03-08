import { ethers } from "ethers";
import {
  ROUTERS,
  TOKENS,
  DEFAULT_PAIRS,
  ROUTER_ABI,
  ERC20_ABI,
  BSC_RPC,
} from "./contracts";

// ─── Read-only provider (public BSC RPC) ─────────────────────────────────────
export function getReadProvider() {
  return new ethers.providers.JsonRpcProvider(BSC_RPC);
}

// ─── Get price from a specific router ────────────────────────────────────────
export async function getPrice(routerAddress, tokenIn, tokenOut, amountIn, provider) {
  try {
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
    const path = [tokenIn.address, tokenOut.address];
    const amountInWei = ethers.utils.parseUnits(amountIn.toString(), tokenIn.decimals);
    const amounts = await router.getAmountsOut(amountInWei, path);
    const amountOut = parseFloat(ethers.utils.formatUnits(amounts[1], tokenOut.decimals));
    return amountOut;
  } catch {
    return null;
  }
}

// ─── Scan all router pairs for arbitrage opportunities ────────────────────────
export async function scanArbitrageOpportunities(amountIn = 1, minProfitPct = 0.5) {
  const provider = getReadProvider();
  const opportunities = [];

  const routerKeys = Object.keys(ROUTERS);

  for (const pair of DEFAULT_PAIRS) {
    const prices = {};

    // Get price from each router
    for (const key of routerKeys) {
      const price = await getPrice(
        ROUTERS[key].address,
        pair.tokenIn,
        pair.tokenOut,
        amountIn,
        provider
      );
      if (price !== null) prices[key] = price;
    }

    const keys = Object.keys(prices);
    if (keys.length < 2) continue;

    // Find best buy (highest out) and worst buy (lowest out)
    let maxKey = keys[0], minKey = keys[0];
    for (const k of keys) {
      if (prices[k] > prices[maxKey]) maxKey = k;
      if (prices[k] < prices[minKey]) minKey = k;
    }

    const bestPrice = prices[maxKey];
    const worstPrice = prices[minKey];
    const profitPct = ((bestPrice - worstPrice) / worstPrice) * 100;

    if (profitPct >= minProfitPct) {
      opportunities.push({
        pair: `${pair.tokenIn.symbol} → ${pair.tokenOut.symbol}`,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        buyFrom: minKey,          // Buy cheap here
        sellTo: maxKey,           // Sell high here
        buyPrice: worstPrice,
        sellPrice: bestPrice,
        profitPct: profitPct.toFixed(3),
        estimatedProfit: ((bestPrice - worstPrice) * amountIn).toFixed(6),
        prices,
        timestamp: Date.now(),
      });
    }

    // All prices (for display even if no arb)
    if (profitPct < minProfitPct) {
      opportunities.push({
        pair: `${pair.tokenIn.symbol} → ${pair.tokenOut.symbol}`,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        buyFrom: minKey,
        sellTo: maxKey,
        buyPrice: worstPrice,
        sellPrice: bestPrice,
        profitPct: profitPct.toFixed(3),
        estimatedProfit: ((bestPrice - worstPrice) * amountIn).toFixed(6),
        prices,
        profitable: false,
        timestamp: Date.now(),
      });
    }
  }

  return opportunities.map((o) => ({
    ...o,
    profitable: parseFloat(o.profitPct) >= minProfitPct,
  }));
}

// ─── Execute arbitrage trade ──────────────────────────────────────────────────
export async function executeArbitrage(opportunity, signer, amountIn, slippagePct = 0.5) {
  const { tokenIn, tokenOut, buyFrom, sellTo } = opportunity;

  const buyRouter = new ethers.Contract(ROUTERS[buyFrom].address, ROUTER_ABI, signer);
  const sellRouter = new ethers.Contract(ROUTERS[sellTo].address, ROUTER_ABI, signer);

  const amountInWei = ethers.utils.parseUnits(amountIn.toString(), tokenIn.decimals);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 3; // 3 min

  const logs = [];

  try {
    // Step 1: Approve buy router to spend tokenIn
    if (tokenIn.symbol !== "WBNB") {
      logs.push(`Approving ${tokenIn.symbol} on ${buyFrom}...`);
      const tokenContract = new ethers.Contract(tokenIn.address, ERC20_ABI, signer);
      const allowance = await tokenContract.allowance(await signer.getAddress(), ROUTERS[buyFrom].address);
      if (allowance.lt(amountInWei)) {
        const approveTx = await tokenContract.approve(ROUTERS[buyFrom].address, ethers.constants.MaxUint256);
        await approveTx.wait();
        logs.push(`✅ Approved ${tokenIn.symbol}`);
      } else {
        logs.push(`✅ ${tokenIn.symbol} already approved`);
      }
    }

    // Step 2: Buy tokenOut cheap on buyFrom router
    logs.push(`Buying ${tokenOut.symbol} on ${buyFrom}...`);
    const buyPath = [tokenIn.address, tokenOut.address];
    const buyAmountsOut = await buyRouter.getAmountsOut(amountInWei, buyPath);
    const minBuyOut = buyAmountsOut[1].mul(1000 - Math.floor(slippagePct * 10)).div(1000);

    let buyTx;
    if (tokenIn.symbol === "WBNB") {
      buyTx = await buyRouter.swapExactETHForTokens(minBuyOut, buyPath, await signer.getAddress(), deadline, {
        value: amountInWei,
      });
    } else {
      buyTx = await buyRouter.swapExactTokensForTokens(amountInWei, minBuyOut, buyPath, await signer.getAddress(), deadline);
    }
    const buyReceipt = await buyTx.wait();
    logs.push(`✅ Bought on ${buyFrom} | Tx: ${buyReceipt.transactionHash}`);

    // Step 3: Approve sell router to spend tokenOut
    logs.push(`Approving ${tokenOut.symbol} on ${sellTo}...`);
    const tokenOutContract = new ethers.Contract(tokenOut.address, ERC20_ABI, signer);
    const tokenOutBalance = await tokenOutContract.balanceOf(await signer.getAddress());
    const sellAllowance = await tokenOutContract.allowance(await signer.getAddress(), ROUTERS[sellTo].address);
    if (sellAllowance.lt(tokenOutBalance)) {
      const approveSellTx = await tokenOutContract.approve(ROUTERS[sellTo].address, ethers.constants.MaxUint256);
      await approveSellTx.wait();
      logs.push(`✅ Approved ${tokenOut.symbol}`);
    }

    // Step 4: Sell tokenOut high on sellTo router
    logs.push(`Selling ${tokenOut.symbol} on ${sellTo}...`);
    const sellPath = [tokenOut.address, tokenIn.address];
    const sellAmountsOut = await sellRouter.getAmountsOut(tokenOutBalance, sellPath);
    const minSellOut = sellAmountsOut[1].mul(1000 - Math.floor(slippagePct * 10)).div(1000);

    let sellTx;
    if (tokenIn.symbol === "WBNB") {
      sellTx = await sellRouter.swapExactTokensForETH(tokenOutBalance, minSellOut, sellPath, await signer.getAddress(), deadline);
    } else {
      sellTx = await sellRouter.swapExactTokensForTokens(tokenOutBalance, minSellOut, sellPath, await signer.getAddress(), deadline);
    }
    const sellReceipt = await sellTx.wait();
    logs.push(`✅ Sold on ${sellTo} | Tx: ${sellReceipt.transactionHash}`);

    logs.push(`🎉 Arbitrage complete! Check your wallet for profit.`);
    return { success: true, logs };
  } catch (err) {
    logs.push(`❌ Error: ${err.message || "Transaction failed"}`);
    return { success: false, logs, error: err.message };
  }
}

// ─── Get wallet token balances ────────────────────────────────────────────────
export async function getBalances(walletAddress, provider) {
  const balances = {};

  // BNB balance
  try {
    const bnbBal = await provider.getBalance(walletAddress);
    balances["BNB"] = parseFloat(ethers.utils.formatEther(bnbBal)).toFixed(4);
  } catch {
    balances["BNB"] = "—";
  }

  // ERC-20 balances
  for (const [symbol, token] of Object.entries(TOKENS)) {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const bal = await contract.balanceOf(walletAddress);
      balances[symbol] = parseFloat(ethers.utils.formatUnits(bal, token.decimals)).toFixed(4);
    } catch {
      balances[symbol] = "—";
    }
  }

  return balances;
}
