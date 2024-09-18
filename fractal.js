const bitcoin = require("bitcoinjs-lib");
const { ECPairFactory } = require("ecpair");
const ecc = require("tiny-secp256k1");
bitcoin.initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const encoder = new TextEncoder()

const network = bitcoin.networks.bitcoin
// const MEMPOOL_URL = `https://mempool.fractalbitcoin.io/`
const MEMPOOL_URL = `https://mempool-testnet.fractalbitcoin.io/`

const DUST_LIMIT = 546
const BASE_TX_SIZE = 10

const BitcoinAddressType = {
  Legacy: 'legacy',
  NestedSegwit: 'nested-segwit',
  NativeSegwit: 'native-segwit',
  Taproot: 'taproot',
  Invalid: 'invalid'
}

const LEGACY_TX_INPUT_SIZE = 148
const LEGACY_TX_OUTPUT_SIZE = 34
const NESTED_SEGWIT_TX_INPUT_SIZE = 91
const NESTED_SEGWIT_TX_OUTPUT_SIZE = 31
const NATIVE_SEGWIT_TX_INPUT_SIZE = 68
const NATIVE_SEGWIT_TX_OUTPUT_SIZE = 31
const TAPROOT_TX_INPUT_SIZE = 58
const TAPROOT_TX_OUTPUT_SIZE = 43


async function getAddressUTXOs(address) {
  const url = `${MEMPOOL_URL}/api/address/${address}/utxo`
  const response = await fetch(url)
  if (response.ok) {
    const utxo_array = await response.json()
    let confirmed = [], unconfirmed = []
    for (const i in utxo_array)
      utxo_array[i]['status']['confirmed'] ? confirmed.push(utxo_array[i]) : unconfirmed.push(utxo_array[i])
    return {
      success: true,
      confirmed: utxo_array.filter((elem) => elem?.status?.confirmed) || [],
      unconfirmed: utxo_array.filter((elem) => !elem?.status?.confirmed) || []
    }
  }
  else {
    return {
      success: false,
      confirmed: [],
      unconfirmed: []
    }
  }
}

async function getConfirmedBalanceFromAddress(address) {
  const { confirmed } = await getAddressUTXOs(address)
  let totalBalance = 0
  for (const i in confirmed)
    totalBalance += parseInt(confirmed[i]['value'])
  return totalBalance
}

async function getSatsbyte() {
  const url = `${MEMPOOL_URL}/api/v1/fees/recommended`
  const response = await fetch(url)
  if (response.ok) {
    const recommendedFees = await response.json()
    return {
      success: true,
      recommendedFees
    }
  }
  else {
    return {
      success: false,
      recommendedFees: {}
    }
  }
}

function getBitcoinAddressType(address) {
  // Regular expressions for different Bitcoin address types
  const legacyRegex = network === bitcoin.networks.bitcoin ? /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/ : /^[m,n][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const nestedSegwitRegex = network === bitcoin.networks.bitcoin ? /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/ : /^[2][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const nativeSegwitRegex = network === bitcoin.networks.bitcoin ? /^(bc1q)[0-9a-z]{35,79}$/ : /^(bc1q)[0-9a-z]{35,79}$/;
  const taprootRegex = network === bitcoin.networks.bitcoin ? /^(bc1p)[0-9a-z]{39,79}$/ : /^(bc1p)[0-9a-z]{39,79}$/;

  if (legacyRegex.test(address)) {
    return BitcoinAddressType.Legacy;
  } else if (nestedSegwitRegex.test(address)) {
    return BitcoinAddressType.NestedSegwit;
  } else if (nativeSegwitRegex.test(address)) {
    return BitcoinAddressType.NativeSegwit;
  } else if (taprootRegex.test(address)) {
    return BitcoinAddressType.Taproot;
  } else {
    return BitcoinAddressType.Invalid;
  }
}

function getAddressFromWIFandType(wif, type) {
  const keyPair = ECPair.fromWIF(wif);

  if (type === BitcoinAddressType.Legacy)
    return bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address
  else if (type === BitcoinAddressType.NestedSegwit)
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }),
      network
    }).address;
  else if (type === BitcoinAddressType.NativeSegwit)
    return bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address
  else if (type === BitcoinAddressType.Taproot) {
    console.log(bitcoin.payments.p2tr({
      internalPubkey: toXOnly(keyPair.publicKey),
      network
    }).address)
    return bitcoin.payments.p2tr({
      internalPubkey: toXOnly(keyPair.publicKey),
      network
    }).address;
  }
  else
    return "invalid"
}

function toXOnly (publicKey) {
  return publicKey.slice(1, 33);
}

function getKeypairInfo (childNode) {
  const childNodeXOnlyPubkey = toXOnly(childNode.publicKey);

  const { address, output } = bitcoin.payments.p2tr({
    internalPubkey: childNodeXOnlyPubkey,
    network
  });

  const tweakedChildNode = childNode.tweak(
    bitcoin.crypto.taggedHash('TapTweak', childNodeXOnlyPubkey),
  );

  return {
    address,
    tweakedChildNode,
    childNodeXOnlyPubkey,
    output,
    childNode
  }
}

function estimateTransactionSize(numInputs, numOutputs, type) {
  let inputSize, outputSize

  switch (type) {
    case BitcoinAddressType.Legacy:
      inputSize = LEGACY_TX_INPUT_SIZE;
      outputSize = LEGACY_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NestedSegwit:
      inputSize = NESTED_SEGWIT_TX_INPUT_SIZE;
      outputSize = NESTED_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.NativeSegwit:
      inputSize = NATIVE_SEGWIT_TX_INPUT_SIZE;
      outputSize = NATIVE_SEGWIT_TX_OUTPUT_SIZE;
      break;
    case BitcoinAddressType.Taproot:
      inputSize = TAPROOT_TX_INPUT_SIZE;
      outputSize = TAPROOT_TX_OUTPUT_SIZE;
      break;
    default:
      throw new Error('Unknown transaction type');
  }

  return BASE_TX_SIZE + (numInputs * inputSize) + (numOutputs * outputSize);
}

function estimateTransactionFee(numInputs, numOutputs, type, feeRate) {
  const txSize = estimateTransactionSize(numInputs, numOutputs, type);
  return txSize * feeRate;
}

async function getTransactionDetailFromTxID(txid) {
  const url = `${MEMPOOL_URL}/api/tx/${txid}/hex`
  const response = await fetch(url)
  if (response.ok) {
    const hex = await response.text()
    const txDetail = bitcoin.Transaction.fromHex(hex)
    return {
      hex,
      txDetail
    }
  }
  return {
    hex: "",
    txDetail: {}
  }
}

async function sendFB(fromAddressPair, toAddress, amountInSats) {

  // validate address types
  const { address: fromAddress, wif: fromWIF } = fromAddressPair
  const fromAddressType = getBitcoinAddressType(fromAddress)
  if (fromAddressType === BitcoinAddressType.Invalid)
    return {
      success: false,
      result: "invalid fromAddress"
    }

  const toAddressType = getBitcoinAddressType(toAddress)
  if (toAddressType === BitcoinAddressType.Invalid)
    return {
      success: false,
      result: "invalid toAddress"
    }

  // first check if that address holds such balance
  const currentBalance = await getConfirmedBalanceFromAddress(fromAddress)
  if (amountInSats >= currentBalance)
    return {
      success: false,
      result: "insufficient confirmed balance"
    }

  // check if fromWIF matches the fromAddress
  const checkingFromAddress = getAddressFromWIFandType(fromWIF, fromAddressType);
  if (fromAddress !== checkingFromAddress)
    return {
      success: false,
      result: "fromAddress does not match with fromWIF"
    }

  // now building transactions based on address types
  const keyPair = ECPair.fromWIF(fromAddressPair.wif);
  const keyPairInfo = getKeypairInfo(keyPair)
  const { confirmed } = await getAddressUTXOs(fromAddress)
  const sortedUTXOs = confirmed.sort((a, b) => parseInt(a.value) - parseInt(b.value))

  // get current mempool state
  const { success, recommendedFees } = await getSatsbyte()
  if (!success)
    return {
      success: false,
      result: "Error while getting mempool state"
    }

  // we are firing transaction at fastestFee because users want immediate withdrawal...
  const { fastestFee } = recommendedFees

  // build transaction
  const psbt = new bitcoin.Psbt({ network });
  let totalInputSats = 0, inputUtxoCount = 0
  let estimatedTransactionFee = estimateTransactionFee(1, 1, toAddressType, fastestFee)
  let inputsAreEnough = false
  for (const i in sortedUTXOs) {
    const { txid, vout, value } = sortedUTXOs[i]
    // Eric bro... better to store transaction hex on the database so that you can reduce unnecessary API calls...
    const { hex, txDetail } = await getTransactionDetailFromTxID(txid)
    if (!hex) {
      return {
        success: false,
        result: `cannot find proper hex for transaction ${txid}`
      }
    }
    const input = {
      hash: txid,
      index: vout
    }

    if (fromAddressType === BitcoinAddressType.Legacy)
      input.nonWitnessUtxo = Buffer.from(hex, 'hex');
    if (fromAddressType === BitcoinAddressType.NestedSegwit) {
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      }
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
      input.redeemScript = p2wpkh.output
    }
    if (fromAddressType === BitcoinAddressType.NativeSegwit)
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      };
    if (fromAddressType === BitcoinAddressType.Taproot) {
      input.witnessUtxo = {
        script: txDetail.outs[vout].script,
        value: txDetail.outs[vout].value,
      };
      input.tapInternalKey = keyPairInfo.childNodeXOnlyPubkey
    }

    psbt.addInput(input)
    inputUtxoCount ++
    totalInputSats += value
    estimatedTransactionFee = estimateTransactionFee(inputUtxoCount, 2, toAddressType, fastestFee)
    if (totalInputSats >= amountInSats + estimatedTransactionFee) {
      inputsAreEnough = true
      psbt.addOutput({
        address: toAddress, 
        value: amountInSats
      })
      if (totalInputSats - amountInSats - estimatedTransactionFee > DUST_LIMIT) 
        psbt.addOutput({
          address: fromAddress, 
          value: totalInputSats - amountInSats - estimatedTransactionFee
        })
    }
  }

  if (!inputsAreEnough) {
    return {
      success: false,
      result: "Input UTXOs are not enough to send..."
    }
  }

  console.log(`sending ${amountInSats} from ${fromAddress} to ${toAddress}`)
  console.log(`estimatedFee: ${estimatedTransactionFee}`)
  console.log(`firing tx at ${fastestFee} satsbyte`)

  if (fromAddressType === BitcoinAddressType.Taproot) {
    for (let i = 0; i < inputUtxoCount; i ++)
      psbt.signInput(i, keyPairInfo.tweakedChildNode)
  }
  else {
    for (let i = 0; i < inputUtxoCount; i ++)
      psbt.signInput(i, keyPairInfo.childNode)
  }

  psbt.finalizeAllInputs()

  const tx = psbt.extractTransaction()
  const txHex = tx.toHex();
  console.log(`raw transaction hex: ${txHex}`)

  // broadcast the transaction
  const broadcastAPI = `${MEMPOOL_URL}/api/tx`
  const response = await fetch(broadcastAPI, {
    method: "POST",
    body: txHex,
  })

  if (response.ok) {
    const transactionId = await response.text()
    return {
      success: true,
      result: transactionId
    }
  }

  return {
    success: false,
    result: 'error while broadcast...'
  }
}

const inscribe = async (mnemonic, recipient, json) => {  
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network);
  const origin_node = root.derivePath("m/86'/0'/0'/0/0");
  const reveal_node = root.derivePath("m/86'/0'/0'/0/1");
  const origin_keypair = ECPair.fromPrivateKey(origin_node.privateKey,{ network })
  const origin_tweaked = tweakSigner(origin_keypair, { network })
  const reveal_keypair = ECPair.fromPrivateKey(reveal_node.privateKey,{ network })  
  origin_address = bitcoin.payments.p2tr({ internalPubkey: toXOnly(origin_node.publicKey), network }).address

  // check normal bitcoin utxos on origin_address
  const utxos = await getNonInscriptionUtxosFromAddress(origin_address)
  if (!utxos || utxos.length < 1) {
    console.log(`No UTXO found for network fee...`)
    return {
      success: false,
      result: `No UTXO found for network fee...`
    }
  }

  //create commit data
  const inscription = createTextInscription({ text: typeof json === "object" ? JSON.stringify(json) : typeof json === "string" ? json : json.toString() })
  const commitTxData = createCommitTxData({publicKey: reveal_keypair.publicKey, inscription })
  const reveal_address = commitTxData.revealAddress

  const { success, recommendedFees } = await getSatsbyte()
  if (!success)
    return {
      success: false,
      result: "Error while getting mempool state"
    }
  const { fastestFee } = recommendedFees

  // const txSize = estimateTransactionSize(1, 1, BitcoinAddressType.Taproot) + Math.floor(inscription.content.length / 4)
  const txSize = estimateTransactionSize(1, 1, BitcoinAddressType.Taproot) + Math.floor(inscription.content.length)
  const feeRate = fastestFee
  // console.log(`tx size: ${txSize}, ${estimateTransactionSize(1, 1, BitcoinAddressType.Taproot)}, ${Math.floor(inscription.content.length / 4)}`)
  let revealTxFee = txSize * feeRate

  // adding this because mempool.space does not accept fee under 3500 sats, only on testnet
  // if (revealTxFee < 4200)
  //   revealTxFee = 4200
  const requiredAmount = revealTxFee + DUST_LIMIT

  // commit tx
  const { success: commitSuccess, result: commitTxIdOrResult} = await sendBitcoin({
    address: origin_address,
    wif: origin_keypair.toWIF(),
  }, reveal_address, requiredAmount)

  if (!commitSuccess) {
    return {
      success: false,
      result: commitTxIdOrResult
    }
  }
  
  //create reveal tx
  const toAddress = recipient ? recipient : origin_address
  const commitTxResult = {
    txId: commitTxIdOrResult,
    sendUtxoIndex: 0,
    sendAmount: requiredAmount,
  }

  const { txId, rawTx, inscriptionId, virtualSize, signature } = await createRevealTx({
    commitTxData,
    commitTxResult,
    toAddress,
    privateKey:reveal_node.privateKey,
    amount: DUST_LIMIT,
  })
  
  // broadcast with retries since commit tx takes some time to be scanned...
  let trials = 0
  while (trials < 5) {
    await sleep(5000)
    const { success: broadcastSuccess, result: revealTxId } = await broadcastRawTx(rawTx)
    if (broadcastSuccess)
      return {
        success: broadcastSuccess,
        result: inscriptionId,
        revealTxId
      }
    trials ++
  }

  return {
    success: false,
    result: 'error while broadcast...'
  }
}


module.exports = {
  getAddressUTXOs,
  sendFB
}