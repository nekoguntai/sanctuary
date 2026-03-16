/**
 * Bitcoin Core key_io Test Vectors (Address Encoding/Decoding)
 * https://github.com/bitcoin/bitcoin/blob/master/src/test/data/key_io_valid.json
 * Filtered to mainnet addresses only (chain="main", isPrivkey=false)
 * DO NOT MODIFY - these are canonical Bitcoin Core test vectors.
 */

export interface KeyIoAddressVector {
  address: string;
  scriptPubKeyHex: string;
  chain: string;
  tryCaseFlip?: boolean;
}

export const KEY_IO_MAINNET_ADDRESSES: KeyIoAddressVector[] = [
  { address: '1FsSia9rv4NeEwvJ2GvXrX7LyxYspbN2mo', scriptPubKeyHex: '76a914a31c06bd463e3923bc1aadbde48b16976c08071788ac', chain: 'main' },
  { address: '36j4NfKv6Akva9amjWrLG6MuSQym1GuEmm', scriptPubKeyHex: 'a914373b819a068f32b7a6b38b6b38729647cfde01c287', chain: 'main' },
  { address: 'bc1qvyq0cc6rahyvsazfdje0twl7ez82ndmuac2lhv', scriptPubKeyHex: '00146100fc6343edc8c874496cb2f5bbfec88ea9b77c', chain: 'main', tryCaseFlip: true },
  { address: 'bc1qyucykdlhp62tezs0hagqury402qwhk589q80tqs5myh3rxq34nwqhkdhv7', scriptPubKeyHex: '002027304b37f70e94bc8a0fbf500e0c957a80ebda87280ef58214d92f119811acdc', chain: 'main', tryCaseFlip: true },
  { address: 'bc1p83n3au0rjylefxq2nc2xh2y4jzz4pm6zxj4mw5pagdjjr2a9f36s6jjnnu', scriptPubKeyHex: '51203c671ef1e3913f94980a9e146ba895908550ef4234abb7503d436521aba54c75', chain: 'main', tryCaseFlip: true },
  { address: 'bc1z2rksukkjr8', scriptPubKeyHex: '520250ed', chain: 'main', tryCaseFlip: true },
  { address: '1FjL87pn8ky6Vbavd1ZHeChRXtoxwRGCRd', scriptPubKeyHex: '76a914a19331b7b2627e663e25a7b001e4c0dcc5e21bc788ac', chain: 'main' },
  { address: '3BZECeAH8gSKkjrTx8PwMrNQBLG18yHpvf', scriptPubKeyHex: 'a9146c382dcdf5b284760c8e3fead91f7422cd76aa8787', chain: 'main' },
  { address: 'bc1qhxt04s5xnpy0kxw4x99n5hpdf5pmtzpqs52es2', scriptPubKeyHex: '0014b996fac2869848fb19d5314b3a5c2d4d03b58820', chain: 'main', tryCaseFlip: true },
  { address: 'bc1qgc9ljrvdf2e0zg9rmmq86xklqwfys7r6wptjlacdgrcdc7sa6ggqu4rrxf', scriptPubKeyHex: '0020460bf90d8d4ab2f120a3dec07d1adf039248787a70572ff70d40f0dc7a1dd210', chain: 'main', tryCaseFlip: true },
  { address: 'bc1pve739yap4uxjvfk0jrey69078u0gasm2nwvv483ec6zkzulgw9xqu4w9fd', scriptPubKeyHex: '5120667d1293a1af0d2626cf90f24d15fe3f1e8ec36a9b98ca9e39c6856173e8714c', chain: 'main', tryCaseFlip: true },
  { address: 'bc1zmjtqxkzs89', scriptPubKeyHex: '5202dc96', chain: 'main', tryCaseFlip: true },
  { address: '1G9A9j6W8TLuh6dEeVwWeyibK1Uc5MfVFV', scriptPubKeyHex: '76a914a614da54daacdb8861f451a0b7e3c27cdf8a099e88ac', chain: 'main' },
  { address: '33GA3ZXbw5o5HeUrBEaqkWXFYYZmdxGRRP', scriptPubKeyHex: 'a914113ca1afeb49ff3abf176ffa19c2a2b4df19712a87', chain: 'main' },
];

// Sample invalid addresses from key_io_invalid.json
export const KEY_IO_INVALID_ADDRESSES: string[] = [
  '',
  'x',
  'bc1gmk9yu',
  'bc1qmgf8xt8xkecl79k04mma3lz34gqep7hg4',
  'bc1qdsuzmn04k2z8vryw8l4dj8m5ygqgnne5n',
  'bc1qpu6d26mrulzetu4jqhd7rsunv9aqru26f5c4j8',
  'bc1qtsvlht6730n04f2mpaj5vv8hrledn5n5ug8c79',
];
