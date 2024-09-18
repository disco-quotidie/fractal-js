const { getAddressUTXOs, sendFB } = require('./fractal')

const test = async () => {
  // const utxos = await getAddressUTXOs("bc1pzere5nqzemjkpf9g3z9k4r86lq7umv3ckntdaxg6p7huszjgs5zs2a3czh")
  const wif = ""
  const address = ""
  const result = await sendFB({
    address,
    wif
  }, "", 1000)
  console.log(result)

  const mnemonic = "they rice talent warm fitness elephant lumber mushroom scan taxi chef guard"
  
}

test()