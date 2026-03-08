import { useState, useEffect, useRef, useCallback } from "react";
import { ethers } from "ethers";
import Head from "next/head";

const PANCAKE_ROUTER  = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const BSC_RPC         = "https://bsc-dataseed1.binance.org/";
const WBNB            = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const TOKENS = {
  WBNB:  { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB",  decimals: 18 },
  BUSD:  { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", symbol: "BUSD",  decimals: 18 },
  USDT:  { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT",  decimals: 18 },
  CAKE:  { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "CAKE",  decimals: 18 },
  ETH:   { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH",   decimals: 18 },
  BTCB:  { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB",  decimals: 18 },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

const ARB_PATHS = [
  { name: "BNB→BUSD→USDT→BNB", path: [TOKENS.WBNB, TOKENS.BUSD, TOKENS.USDT, TOKENS.WBNB] },
  { name: "BNB→USDT→BUSD→BNB", path: [TOKENS.WBNB, TOKENS.USDT, TOKENS.BUSD, TOKENS.WBNB] },
  { name: "BNB→CAKE→BUSD→BNB", path: [TOKENS.WBNB, TOKENS.CAKE, TOKENS.BUSD, TOKENS.WBNB] },
  { name: "BNB→ETH→BUSD→BNB",  path: [TOKENS.WBNB, TOKENS.ETH,  TOKENS.BUSD, TOKENS.WBNB] },
  { name: "BNB→BTCB→BUSD→BNB", path: [TOKENS.WBNB, TOKENS.BTCB, TOKENS.BUSD, TOKENS.WBNB] },
  { name: "BNB→BUSD→CAKE→BNB", path: [TOKENS.WBNB, TOKENS.BUSD, TOKENS.CAKE, TOKENS.WBNB] },
];

export default function ArbitrageBot() {
  const [wallet, setWallet]         = useState(null);
  const [provider, setProvider]     = useState(null);
  const [signer, setSigner]         = useState(null);
  const [balance, setBalance]       = useState("0");
  const [isRunning, setIsRunning]   = useState(false);
  const [opportunities, setOpp]     = useState([]);
  const [logs, setLogs]             = useState([]);
  const [stats, setStats]           = useState({ trades: 0, profit: 0, scans: 0 });
  const [tradeAmount, setTradeAmt]  = useState("0.05");
  const [minProfit, setMinProfit]   = useState("0.3");
  const [autoExecute, setAutoExec]  = useState(false);
  const [gasPrice, setGasPrice]     = useState("5");
  const [network, setNetwork]       = useState(null);
  const intervalRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs(prev => [{ ts, msg, type, id: Date.now() + Math.random() }, ...prev].slice(0, 120));
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) { addLog("MetaMask not detected.", "error"); return; }
    try {
      addLog("Requesting wallet connection...", "info");
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
      await web3Provider.send("eth_requestAccounts", []);
      const web3Signer = web3Provider.getSigner();
      const address    = await web3Signer.getAddress();
      const net        = await web3Provider.getNetwork();
      const bnbBal     = await web3Provider.getBalance(address);
      setProvider(web3Provider); setSigner(web3Signer);
      setWallet(address); setNetwork(net);
      setBalance(parseFloat(ethers.utils.formatEther(bnbBal)).toFixed(4));
      addLog("Wallet connected: " + address.slice(0,6) + "..." + address.slice(-4), "success");
      addLog("Network: " + net.name + " (chainId: " + net.chainId + ")", "info");
      if (net.chainId !== 56) {
        addLog("Switch to BSC Mainnet (chainId 56) for live trading!", "warn");
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
        } catch { addLog("Add BSC Mainnet manually in MetaMask.", "warn"); }
      }
    } catch (e) { addLog("Connection failed: " + e.message, "error"); }
  };

  const disconnect = () => {
    setWallet(null); setSigner(null); setProvider(null); setIsRunning(false);
    clearInterval(intervalRef.current);
    addLog("Wallet disconnected.", "warn");
  };

  const scanPath = async (arbPath, readProvider) => {
    try {
      const router   = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, readProvider);
      const amountIn = ethers.utils.parseEther(tradeAmount);
      const addresses = arbPath.path.map(t => t.address);
      const amounts  = await router.getAmountsOut(amountIn, addresses);
      const amountOut = amounts[amounts.length - 1];
      const inputBNB  = parseFloat(tradeAmount);
      const outputBNB = parseFloat(ethers.utils.formatEther(amountOut));
      const profitBNB = outputBNB - inputBNB;
      const profitPct = (profitBNB / inputBNB) * 100;
      const gasCostBNB = 3 * 150000 * parseFloat(gasPrice) * 1e-9;
      const netProfit  = profitBNB - gasCostBNB;
      const netPct     = (netProfit / inputBNB) * 100;
      return { name: arbPath.name, path: arbPath.path, addresses, amountIn, amountOut,
        inputBNB, outputBNB, profitBNB, profitPct, gasCostBNB, netProfit, netPct,
        profitable: netPct > parseFloat(minProfit), timestamp: Date.now() };
    } catch { return null; }
  };

  const executeTrade = async (opp) => {
    if (!signer) { addLog("No signer - connect wallet first.", "error"); return; }
    try {
      addLog("Executing: " + opp.name, "exec");
      const router   = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, signer);
      const deadline = Math.floor(Date.now() / 1000) + 60;
      const minOut   = opp.amountOut.mul(995).div(1000);
      const gp       = ethers.utils.parseUnits(gasPrice, "gwei");
      let tx;
      if (opp.addresses[0].toLowerCase() === WBNB.toLowerCase()) {
        tx = await router.swapExactETHForTokens(0, opp.addresses, await signer.getAddress(), deadline,
          { value: opp.amountIn, gasPrice: gp, gasLimit: 600000 });
      } else {
        const token = new ethers.Contract(opp.addresses[0], ERC20_ABI, signer);
        const allowance = await token.allowance(await signer.getAddress(), PANCAKE_ROUTER);
        if (allowance.lt(opp.amountIn)) {
          addLog("Approving token...", "info");
          const approveTx = await token.approve(PANCAKE_ROUTER, ethers.constants.MaxUint256, { gasPrice: gp });
          await approveTx.wait();
        }
        tx = await router.swapExactTokensForTokens(opp.amountIn, minOut, opp.addresses,
          await signer.getAddress(), deadline, { gasPrice: gp, gasLimit: 600000 });
      }
      addLog("TX sent: " + tx.hash.slice(0,12) + "...", "info");
      const receipt = await tx.wait();
      addLog("Confirmed! Block " + receipt.blockNumber + " | Net: +" + opp.netProfit.toFixed(5) + " BNB", "success");
      setStats(s => ({ ...s, trades: s.trades + 1, profit: s.profit + opp.netProfit }));
      const newBal = await signer.provider.getBalance(await signer.getAddress());
      setBalance(parseFloat(ethers.utils.formatEther(newBal)).toFixed(4));
    } catch (e) { addLog("Trade failed: " + (e.reason || e.message), "error"); }
  };

  const runScan = useCallback(async () => {
    const readProvider = provider || new ethers.providers.JsonRpcProvider(BSC_RPC);
    setStats(s => ({ ...s, scans: s.scans + 1 }));
    const results = await Promise.all(ARB_PATHS.map(p => scanPath(p, readProvider)));
    const valid   = results.filter(Boolean).sort((a, b) => b.netPct - a.netPct);
    setOpp(valid);
    const best = valid.find(o => o.profitable);
    if (best) {
      addLog("Opportunity: " + best.name + " | Net: +" + best.netPct.toFixed(3) + "%", "profit");
      if (autoExecute && signer) await executeTrade(best);
    }
  }, [provider, signer, tradeAmount, minProfit, gasPrice, autoExecute]);

  const toggleBot = () => {
    if (isRunning) {
      clearInterval(intervalRef.current); setIsRunning(false);
      addLog("Bot stopped.", "warn");
    } else {
      addLog("Bot started - scanning every 4 seconds...", "success");
      setIsRunning(true); runScan();
      intervalRef.current = setInterval(runScan, 4000);
    }
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const shortAddr = wallet ? wallet.slice(0,6) + "..." + wallet.slice(-4) : null;

  return (
    <>
      <Head>
        <title>PancakeSwap Arb Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#020b0f;--panel:#041218;--border:#0e3040;
          --green:#00ff87;--cyan:#00e5ff;--red:#ff3b5c;--yellow:#ffe259;
          --dim:#2a4a55;--text:#c8eef5;--muted:#4a7a8a;
          --mono:'Share Tech Mono',monospace;--head:'Orbitron',sans-serif;
        }
        body{background:var(--bg);color:var(--text);font-family:var(--mono);min-height:100vh;overflow-x:hidden}
        body::before{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,135,.015) 2px,rgba(0,255,135,.015) 4px);pointer-events:none;z-index:9999}
        .wrap{max-width:1400px;margin:0 auto;padding:16px}
        header{display:flex;align-items:center;justify-content:space-between;padding:16px 0 24px;border-bottom:1px solid var(--border);margin-bottom:20px;flex-wrap:wrap;gap:12px}
        .logo{display:flex;align-items:center;gap:12px}
        .logo-icon{width:44px;height:44px;border-radius:50%;background:conic-gradient(var(--green),var(--cyan),var(--green));display:grid;place-items:center;font-size:22px;box-shadow:0 0 20px rgba(0,255,135,.4);animation:spin 8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .logo h1{font-family:var(--head);font-size:20px;color:var(--green);letter-spacing:2px}
        .logo p{font-size:11px;color:var(--muted);letter-spacing:3px}
        .w-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 1.5s infinite}
        .dot.off{background:var(--red);box-shadow:0 0 8px var(--red);animation:none}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .chip{background:var(--panel);border:1px solid var(--border);padding:6px 14px;border-radius:4px;color:var(--cyan);letter-spacing:1px;font-size:12px}
        .chip.g{background:rgba(0,255,135,.08);border-color:rgba(0,255,135,.2);color:var(--green);font-weight:bold}
        .btn{font-family:var(--mono);font-size:12px;letter-spacing:2px;padding:8px 20px;border-radius:3px;border:none;cursor:pointer;transition:all .15s;text-transform:uppercase}
        .btn-p{background:var(--green);color:#000;font-weight:bold;box-shadow:0 0 12px rgba(0,255,135,.4)}
        .btn-p:hover{box-shadow:0 0 24px rgba(0,255,135,.7);transform:translateY(-1px)}
        .btn-o{background:transparent;color:var(--cyan);border:1px solid var(--cyan)}
        .btn-o:hover{background:rgba(0,229,255,.1)}
        .nbadge{font-size:10px;padding:3px 8px;border-radius:2px;background:rgba(0,255,135,.1);color:var(--green);border:1px solid rgba(0,255,135,.3)}
        .nbadge.w{background:rgba(255,59,92,.1);color:var(--red);border-color:rgba(255,59,92,.3)}
        .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
        @media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}
        .sc{background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:12px 16px}
        .sc-l{font-size:9px;letter-spacing:3px;color:var(--muted);text-transform:uppercase;margin-bottom:6px}
        .sc-v{font-family:var(--head);font-size:22px;color:var(--green)}
        .warn{background:rgba(255,226,89,.07);border:1px solid rgba(255,226,89,.3);border-radius:4px;padding:10px 14px;font-size:11px;color:var(--yellow);line-height:1.7;margin-bottom:16px}
        .grid{display:grid;gap:16px;grid-template-columns:260px 1fr 340px}
        @media(max-width:1100px){.grid{grid-template-columns:1fr 1fr}}
        @media(max-width:700px){.grid{grid-template-columns:1fr}}
        .panel{background:var(--panel);border:1px solid var(--border);border-radius:6px;overflow:hidden}
        .panel.active{border-color:rgba(0,255,135,.3);box-shadow:0 0 20px rgba(0,255,135,.08)}
        .ph{background:rgba(0,229,255,.04);border-bottom:1px solid var(--border);padding:10px 16px;font-family:var(--head);font-size:10px;letter-spacing:3px;color:var(--cyan);text-transform:uppercase;display:flex;align-items:center;justify-content:space-between}
        .pb{padding:16px}
        .cl{font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:6px;display:block;text-transform:uppercase}
        .ci{width:100%;background:#061822;border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:14px;padding:8px 12px;border-radius:3px;outline:none;margin-bottom:14px;transition:border-color .15s}
        .ci:focus{border-color:var(--cyan)}
        .tr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        .tl{font-size:11px;letter-spacing:1px;color:var(--text)}
        .tog{width:44px;height:24px;background:var(--dim);border-radius:12px;position:relative;cursor:pointer;transition:background .2s;border:none}
        .tog.on{background:var(--green)}
        .tog::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}
        .tog.on::after{left:23px}
        .ticker{font-size:10px;color:var(--muted);letter-spacing:1px;border-top:1px solid var(--border);padding-top:8px;margin-bottom:8px}
        .run{width:100%;padding:14px;font-family:var(--head);font-size:14px;letter-spacing:4px;border:none;border-radius:4px;cursor:pointer;margin-top:8px;transition:all .2s;text-transform:uppercase}
        .run.go{background:linear-gradient(135deg,#00ff87,#00c47d);color:#000;box-shadow:0 4px 20px rgba(0,255,135,.3)}
        .run.go:hover{box-shadow:0 4px 32px rgba(0,255,135,.6);transform:translateY(-2px)}
        .run.stop{background:linear-gradient(135deg,#ff3b5c,#c0002e);color:#fff}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{font-family:var(--head);font-size:9px;letter-spacing:2px;color:var(--muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);text-transform:uppercase}
        td{padding:10px;border-bottom:1px solid rgba(14,48,64,.5);vertical-align:middle}
        tr:hover td{background:rgba(0,229,255,.03)}
        .hot td:first-child{border-left:2px solid var(--green)}
        .pp{font-family:var(--head);font-size:13px}
        .pp.pos{color:var(--green)} .pp.neg{color:var(--red)}
        .eb{font-family:var(--mono);font-size:10px;letter-spacing:1px;padding:4px 10px;border-radius:2px;border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer;text-transform:uppercase;transition:all .15s}
        .eb:hover{background:var(--green);color:#000}
        .eb:disabled{opacity:.3;cursor:default;border-color:var(--dim);color:var(--dim)}
        .logbox{height:380px;overflow-y:auto;font-size:11px;line-height:1.8;padding:8px}
        .logbox::-webkit-scrollbar{width:4px}
        .logbox::-webkit-scrollbar-thumb{background:var(--dim);border-radius:2px}
        .le{display:flex;gap:8px;padding:1px 0}
        .lts{color:var(--dim);min-width:70px}
        .lm.info{color:var(--text)} .lm.success{color:var(--green)} .lm.error{color:var(--red)}
        .lm.warn{color:var(--yellow)} .lm.profit{color:var(--cyan);font-weight:bold} .lm.exec{color:#ff9f43}
        .empty{text-align:center;padding:40px 20px;color:var(--dim);font-size:12px;letter-spacing:2px}
        footer{border-top:1px solid var(--border);margin-top:24px;padding-top:16px;font-size:10px;color:var(--dim);letter-spacing:2px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
      `}</style>

      <div className="wrap">
        <header>
          <div className="logo">
            <div className="logo-icon">🥞</div>
            <div>
              <h1>PANCAKE ARB</h1>
              <p>TRIANGULAR ARBITRAGE BOT · BSC</p>
            </div>
          </div>
          <div className="w-bar">
            {isRunning && <div className="dot" />}
            {!isRunning && wallet && <div className="dot off" />}
            {network && <span className={"nbadge" + (network.chainId === 56 ? "" : " w")}>{network.chainId === 56 ? "BSC MAINNET" : "Chain " + network.chainId}</span>}
            {wallet ? (
              <>
                <span className="chip">{shortAddr}</span>
                <span className="chip g">{balance} BNB</span>
                <button className="btn btn-o" onClick={disconnect}>Disconnect</button>
              </>
            ) : (
              <button className="btn btn-p" onClick={connectWallet}>Connect Wallet</button>
            )}
          </div>
        </header>

        <div className="stats">
          {[
            ["TOTAL SCANS", stats.scans.toLocaleString(), "neutral"],
            ["TRADES EXEC", stats.trades, "neutral"],
            ["NET PROFIT (BNB)", (stats.profit >= 0 ? "+" : "") + stats.profit.toFixed(5), stats.profit >= 0 ? "pos" : "neg"],
            ["OPPORTUNITIES", opportunities.filter(o=>o.profitable).length + " / " + opportunities.length, "neutral"],
          ].map(([l,v,c],i) => (
            <div className="sc" key={i}>
              <div className="sc-l">{l}</div>
              <div className="sc-v" style={c==="neg"?{color:"var(--red)"}:{}}>{v}</div>
            </div>
          ))}
        </div>

        <div className="warn">
          ⚠️ &nbsp;<strong>RISK DISCLAIMER:</strong> DeFi arbitrage carries significant risk. Transactions can fail due to slippage, front-running (MEV bots), and gas costs. Never trade more than you can afford to lose. Test on testnet first.
        </div>

        <div className="grid">
          {/* Config */}
          <div>
            <div className={"panel" + (isRunning ? " active" : "")}>
              <div className="ph">⚙ Configuration</div>
              <div className="pb">
                <label className="cl">Trade Amount (BNB)</label>
                <input className="ci" type="number" min="0.01" step="0.01" value={tradeAmount} onChange={e=>setTradeAmt(e.target.value)} />
                <label className="cl">Min Profit Threshold (%)</label>
                <input className="ci" type="number" min="0.1" step="0.1" value={minProfit} onChange={e=>setMinProfit(e.target.value)} />
                <label className="cl">Gas Price (Gwei)</label>
                <input className="ci" type="number" min="3" step="0.5" value={gasPrice} onChange={e=>setGasPrice(e.target.value)} />
                <div className="tr">
                  <span className="tl">Auto-Execute Trades</span>
                  <button className={"tog" + (autoExecute ? " on" : "")} onClick={()=>{setAutoExec(v=>!v);addLog("Auto-execute " + (!autoExecute ? "ENABLED" : "DISABLED") + ".", "warn")}} />
                </div>
                <div className="ticker">Scan: 4s · Paths: {ARB_PATHS.length} · Slippage: 0.5%</div>
                <button className={"run" + (isRunning ? " stop" : " go")} onClick={toggleBot}>
                  {isRunning ? "⏹ Stop Bot" : "▶ Start Scanning"}
                </button>
                {!wallet && <button className="btn btn-p" style={{width:"100%",marginTop:8}} onClick={connectWallet}>Connect Wallet First</button>}
              </div>
            </div>

            <div className="panel" style={{marginTop:16}}>
              <div className="ph">📍 Scanned Paths</div>
              <div className="pb" style={{fontSize:11,lineHeight:2}}>
                {ARB_PATHS.map((p,i) => (
                  <div key={i} style={{color:"var(--muted)",borderBottom:"1px solid var(--border)",paddingBottom:4,marginBottom:4}}>
                    <span style={{color:"var(--cyan)",marginRight:8}}>{i+1}.</span>{p.name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Opportunities */}
          <div>
            <div className="panel">
              <div className="ph">
                <span>⚡ Live Opportunities</span>
                {isRunning && <span style={{color:"var(--green)",fontSize:9}}>● LIVE</span>}
              </div>
              <div style={{overflowX:"auto"}}>
                {opportunities.length === 0 ? (
                  <div className="empty">{isRunning ? "SCANNING MARKETS..." : "START BOT TO SCAN"}</div>
                ) : (
                  <table>
                    <thead><tr><th>Path</th><th>Output BNB</th><th>Gross %</th><th>Net %</th><th>Gas</th><th>Action</th></tr></thead>
                    <tbody>
                      {opportunities.map((o,i) => (
                        <tr key={i} className={o.profitable ? "hot" : ""}>
                          <td style={{fontSize:11,color:o.profitable?"var(--green)":"var(--muted)",maxWidth:160}}>{o.profitable && "🔥 "}{o.name}</td>
                          <td style={{color:o.outputBNB>o.inputBNB?"var(--green)":"var(--red)"}}>{o.outputBNB.toFixed(5)}</td>
                          <td><span className={"pp " + (o.profitPct>=0?"pos":"neg")}>{o.profitPct>=0?"+":""}{o.profitPct.toFixed(3)}%</span></td>
                          <td><span className={"pp " + (o.netPct>=parseFloat(minProfit)?"pos":"neg")}>{o.netPct>=0?"+":""}{o.netPct.toFixed(3)}%</span></td>
                          <td style={{color:"var(--muted)",fontSize:10}}>{o.gasCostBNB.toFixed(5)}</td>
                          <td><button className="eb" disabled={!signer||!o.profitable} onClick={()=>executeTrade(o)}>{o.profitable?"EXEC":"LOW"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Logs */}
          <div>
            <div className="panel" style={{height:"100%"}}>
              <div className="ph">
                <span>📋 Activity Log</span>
                <button className="btn" style={{fontSize:9,padding:"2px 8px",background:"transparent",color:"var(--muted)",border:"1px solid var(--border)"}} onClick={()=>setLogs([])}>CLEAR</button>
              </div>
              <div className="logbox">
                {logs.length === 0 && <div style={{color:"var(--dim)",fontSize:11,padding:8}}>Awaiting activity...</div>}
                {logs.map(l => (
                  <div key={l.id} className="le">
                    <span className="lts">[{l.ts}]</span>
                    <span className={"lm " + l.type}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer>
          <span>PANCAKESWAP V2 · BSC MAINNET · TRIANGLE ARB</span>
          <span>ROUTER: {PANCAKE_ROUTER.slice(0,10)}...</span>
          <span>NEVER SHARE YOUR PRIVATE KEY</span>
        </footer>
      </div>
    </>
  );
}
