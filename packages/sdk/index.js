const { ethers } = require("ethers");

const HOOK_QUOTE_DATA_TYPE =
  "tuple(address user,address agent,uint256 amountOut,uint256 minAmountOut,uint64 quoteDeadline,uint64 validUntil,uint256 nonce,bytes32 requestSalt,bytes signature)";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

function toBigIntValue(value) {
  return typeof value === "bigint" ? value : BigInt(value);
}

function normalizeSalt(requestSalt) {
  return requestSalt || ZERO_BYTES32;
}

function computeRequestId({ sender, amountIn, tokenIn, tokenOut, zeroForOne, requestSalt = ZERO_BYTES32 }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "address", "bool", "bytes32"],
      [sender, toBigIntValue(amountIn), tokenIn, tokenOut, Boolean(zeroForOne), normalizeSalt(requestSalt)]
    )
  );
}

function quoteMessageHash({ hook, chainId, requestId, amountOut, validUntil, nonce }) {
  return ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
    [hook, toBigIntValue(chainId), requestId, toBigIntValue(amountOut), toBigIntValue(validUntil), toBigIntValue(nonce)]
  );
}

async function signQuote({ signer, hook, chainId, requestId, amountOut, validUntil, nonce }) {
  const digest = quoteMessageHash({ hook, chainId, requestId, amountOut, validUntil, nonce });
  return signer.signMessage(ethers.getBytes(digest));
}

function encodeHookData(payload) {
  const quoteData = {
    user: payload.user,
    agent: payload.agent,
    amountOut: toBigIntValue(payload.amountOut || 0),
    minAmountOut: toBigIntValue(payload.minAmountOut || 0),
    quoteDeadline: toBigIntValue(payload.quoteDeadline || 0),
    validUntil: toBigIntValue(payload.validUntil || 0),
    nonce: toBigIntValue(payload.nonce || 0),
    requestSalt: normalizeSalt(payload.requestSalt),
    signature: payload.signature || "0x"
  };

  return ethers.AbiCoder.defaultAbiCoder().encode([HOOK_QUOTE_DATA_TYPE], [quoteData]);
}

function decodeHookData(hookData) {
  const [quoteData] = ethers.AbiCoder.defaultAbiCoder().decode([HOOK_QUOTE_DATA_TYPE], hookData);
  return {
    user: quoteData.user,
    agent: quoteData.agent,
    amountOut: quoteData.amountOut,
    minAmountOut: quoteData.minAmountOut,
    quoteDeadline: quoteData.quoteDeadline,
    validUntil: quoteData.validUntil,
    nonce: quoteData.nonce,
    requestSalt: quoteData.requestSalt,
    signature: quoteData.signature
  };
}

function buildQuotePayload({ user, agent, amountOut, minAmountOut, quoteDeadline, validUntil, nonce, requestSalt, signature }) {
  return {
    user,
    agent,
    amountOut: toBigIntValue(amountOut || 0),
    minAmountOut: toBigIntValue(minAmountOut || 0),
    quoteDeadline: toBigIntValue(quoteDeadline || 0),
    validUntil: toBigIntValue(validUntil || 0),
    nonce: toBigIntValue(nonce || 0),
    requestSalt: normalizeSalt(requestSalt),
    signature: signature || "0x"
  };
}

module.exports = {
  HOOK_QUOTE_DATA_TYPE,
  ZERO_BYTES32,
  buildQuotePayload,
  computeRequestId,
  decodeHookData,
  encodeHookData,
  quoteMessageHash,
  signQuote
};
