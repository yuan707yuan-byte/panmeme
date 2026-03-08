// ─── BSC Contract Addresses ──────────────────────────────────────────────────

export const ROUTERS = {
  PancakeSwap: {
    name: "PancakeSwap V2",
    address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    color: "#1FC7D4",
  },
  ApeSwap: {
    name: "ApeSwap",
    address: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
    color: "#A16552",
  },
  BiSwap: {
    name: "BiSwap",
    address: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
    color: "#2B6CB0",
  },
};

export const TOKENS = {
  WBNB: {
    symbol: "WBNB",
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    decimals: 18,
  },
  BUSD: {
    symbol: "BUSD",
    address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    decimals: 18,
  },
  USDT: {
    symbol: "USDT",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
  CAKE: {
    symbol: "CAKE",
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    decimals: 18,
  },
  ETH: {
    symbol: "ETH",
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    decimals: 18,
  },
  BTCB: {
    symbol: "BTCB",
    address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    decimals: 18,
  },
};

export const DEFAULT_PAIRS = [
  { tokenIn: TOKENS.WBNB, tokenOut: TOKENS.BUSD },
  { tokenIn: TOKENS.WBNB, tokenOut: TOKENS.USDT },
  { tokenIn: TOKENS.CAKE, tokenOut: TOKENS.BUSD },
  { tokenIn: TOKENS.ETH,  tokenOut: TOKENS.BUSD },
  { tokenIn: TOKENS.BTCB, tokenOut: TOKENS.BUSD },
];

// ─── Minimal ABIs ─────────────────────────────────────────────────────────────

export const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export const BSC_RPC = "https://bsc-dataseed1.binance.org/";
export const BSC_CHAIN_ID = 56;
