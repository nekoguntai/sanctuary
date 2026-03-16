/**
 * BIP-341 Official Test Vectors (Taproot: SegWit version 1 spending rules)
 * https://github.com/bitcoin/bips/blob/master/bip-0341/wallet-test-vectors.json
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

export interface Bip341ScriptPubKeyVector {
  internalPubkey: string;
  merkleRoot: string | null;
  expectedTweak: string;
  expectedTweakedPubkey: string;
  expectedScriptPubKey: string;
  expectedAddress: string;
}

export const BIP341_SCRIPTPUBKEY_VECTORS: Bip341ScriptPubKeyVector[] = [
  {
    internalPubkey: 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d',
    merkleRoot: null,
    expectedTweak: 'b86e7be8f39bab32a6f2c0443abbc210f0edac0e2c53d501b36b64437d9c6c70',
    expectedTweakedPubkey: '53a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343',
    expectedScriptPubKey: '512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343',
    expectedAddress: 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
  },
  {
    internalPubkey: '187791b6f712a8ea41c8ecdd0ee77fab3e85263b37e1ec18a3651926b3a6cf27',
    merkleRoot: '5b75adecf53548f3ec6ad7d78383bf84cc57b55a3127c72b9a2481752dd88b21',
    expectedTweak: 'cbd8679ba636c1110ea247542cfbd964131a6be84f873f7f3b62a777528ed001',
    expectedTweakedPubkey: '147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3',
    expectedScriptPubKey: '5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3',
    expectedAddress: 'bc1pz37fc4cn9ah8anwm4xqqhvxygjf9rjf2resrw8h8w4tmvcs0863sa2e586',
  },
  {
    internalPubkey: '93478e9488f956df2396be2ce6c5cced75f900dfa18e7dabd2428aae78451820',
    merkleRoot: 'c525714a7f49c28aedbbba78c005931a81c234b2f6c99a73e4d06082adc8bf2b',
    expectedTweak: '6af9e28dbf9d6aaf027696e2598a5b3d056f5fd2355a7fd5a37a0e5008132d30',
    expectedTweakedPubkey: 'e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e',
    expectedScriptPubKey: '5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e',
    expectedAddress: 'bc1punvppl2stp38f7kwv2u2spltjuvuaayuqsthe34hd2dyy5w4g58qqfuag5',
  },
  {
    internalPubkey: 'ee4fe085983462a184015d1f782d6a5f8b9c2b60130aff050ce221ecf3786592',
    merkleRoot: '6c2dc106ab816b73f9d07e3cd1ef2c8c1256f519748e0813e4edd2405d277bef',
    expectedTweak: '9e0517edc8259bb3359255400b23ca9507f2a91cd1e4250ba068b4eafceba4a9',
    expectedTweakedPubkey: '712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5',
    expectedScriptPubKey: '5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5',
    expectedAddress: 'bc1pwyjywgrd0ffr3tx8laflh6228dj98xkjj8rum0zfpd6h0e930h6saqxrrm',
  },
  {
    internalPubkey: 'f9f400803e683727b14f463836e1e78e1c64417638aa066919291a225f0e8dd8',
    merkleRoot: 'ab179431c28d3b68fb798957faf5497d69c883c6fb1e1cd9f81483d87bac90cc',
    expectedTweak: '639f0281b7ac49e742cd25b7f188657626da1ad169209078e2761cefd91fd65e',
    expectedTweakedPubkey: '77e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220',
    expectedScriptPubKey: '512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220',
    expectedAddress: 'bc1pwl3s54fzmk0cjnpl3w9af39je7pv5ldg504x5guk2hpecpg2kgsqaqstjq',
  },
  {
    internalPubkey: 'e0dfe2300b0dd746a3f8674dfd4525623639042569d829c7f0eed9602d263e6f',
    merkleRoot: 'ccbd66c6f7e8fdab47b3a486f59d28262be857f30d4773f2d5ea47f7761ce0e2',
    expectedTweak: 'b57bfa183d28eeb6ad688ddaabb265b4a41fbf68e5fed2c72c74de70d5a786f4',
    expectedTweakedPubkey: '91b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605',
    expectedScriptPubKey: '512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605',
    expectedAddress: 'bc1pjxmy65eywgafs5tsunw95ruycpqcqnev6ynxp7jaasylcgtcxczs6n332e',
  },
  {
    internalPubkey: '55adf4e8967fbd2e29f20ac896e60c3b0f1d5b0efa9d34941b5958c7b0a0312d',
    merkleRoot: '2f6b2c5397b6d68ca18e09a3f05161668ffe93a988582d55c6f07bd5b3329def',
    expectedTweak: '6579138e7976dc13b6a92f7bfd5a2fc7684f5ea42419d43368301470f3b74ed9',
    expectedTweakedPubkey: '75169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831',
    expectedScriptPubKey: '512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831',
    expectedAddress: 'bc1pw5tf7sqp4f50zka7629jrr036znzew70zxyvvej3zrpf8jg8hqcssyuewe',
  },
];

// Key path spending sighash vectors
export interface Bip341KeyPathVector {
  txinIndex: number;
  hashType: number;
  expectedSigHash: string;
  expectedWitness: string;
}

export const BIP341_KEYPATH_TX_HEX = '02000000097de20cbff686da83a54981d2b9bab3586f4ca7e48f57f5b55963115f3b334e9c010000000000000000d7b7cab57b1393ace2d064f4d4a2cb8af6def61273e127517d44759b6dafdd990000000000fffffffff8e1f583384333689228c5d28eac13366be082dc57441760d957275419a418420000000000fffffffff0689180aa63b30cb162a73c6d2a38b7eeda2a83ece74310fda0843ad604853b0100000000feffffffaa5202bdf6d8ccd2ee0f0202afbbb7461d9264a25e5bfd3c5a52ee1239e0ba6c0000000000feffffff956149bdc66faa968eb2be2d2faa29718acbfe3941215893a2a3446d32acd050000000000000000000e664b9773b88c09c32cb70a2a3e4da0ced63b7ba3b22f848531bbb1d5d5f4c94010000000000000000e9aa6b8e6c9de67619e6a3924ae25696bb7b694bb677a632a74ef7eadfd4eabf0000000000ffffffffa778eb6a263dc090464cd125c466b5a99667720b1c110468831d058aa1b82af10100000000ffffffff0200ca9a3b000000001976a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac807840cb0000000020ac9a87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b0065cd1d';

export interface Bip341UtxoSpent {
  scriptPubKeyHex: string;
  amountSats: number;
}

export const BIP341_KEYPATH_UTXOS: Bip341UtxoSpent[] = [
  { scriptPubKeyHex: '512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343', amountSats: 420000000 },
  { scriptPubKeyHex: '5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3', amountSats: 462000000 },
  { scriptPubKeyHex: '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac', amountSats: 294000000 },
  { scriptPubKeyHex: '5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e', amountSats: 504000000 },
  { scriptPubKeyHex: '512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605', amountSats: 630000000 },
  { scriptPubKeyHex: '00147dd65592d0ab2fe0d0257d571abf032cd9db93dc', amountSats: 378000000 },
  { scriptPubKeyHex: '512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831', amountSats: 672000000 },
  { scriptPubKeyHex: '5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5', amountSats: 546000000 },
  { scriptPubKeyHex: '512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220', amountSats: 588000000 },
];

// Precomputed intermediate hashes for the key path spending transaction
export const BIP341_PRECOMPUTED = {
  hashAmounts: '58a6964a4f5f8f0b642ded0a8a553be7622a719da71d1f5befcefcdee8e0fde6',
  hashOutputs: 'a2e6dab7c1f0dcd297c8d61647fd17d821541ea69c3cc37dcbad7f90d4eb4bc5',
  hashPrevouts: 'e3b33bb4ef3a52ad1fffb555c0d82828eb22737036eaeb02a235d82b909c4c3f',
  hashScriptPubkeys: '23ad0f61ad2bca5ba6a7693f50fce988e17c3780bf2b1e720cfbb38fbdd52e21',
  hashSequences: '18959c7221ab5ce9e26c3cd67b22c24f8baa54bac281d8e6b05e400e6c3a957e',
};

export const BIP341_KEYPATH_VECTORS: Bip341KeyPathVector[] = [
  { txinIndex: 0, hashType: 3, expectedSigHash: '2514a6272f85cfa0f45eb907fcb0d121b808ed37c6ea160a5a9046ed5526d555', expectedWitness: 'ed7c1647cb97379e76892be0cacff57ec4a7102aa24296ca39af7541246d8ff14d38958d4cc1e2e478e4d4a764bbfd835b16d4e314b72937b29833060b87276c03' },
  { txinIndex: 1, hashType: 131, expectedSigHash: '325a644af47e8a5a2591cda0ab0723978537318f10e6a63d4eed783b96a71a4d', expectedWitness: '052aedffc554b41f52b521071793a6b88d6dbca9dba94cf34c83696de0c1ec35ca9c5ed4ab28059bd606a4f3a657eec0bb96661d42921b5f50a95ad33675b54f83' },
  { txinIndex: 3, hashType: 1, expectedSigHash: 'bf013ea93474aa67815b1b6cc441d23b64fa310911d991e713cd34c7f5d46669', expectedWitness: 'ff45f742a876139946a149ab4d9185574b98dc919d2eb6754f8abaa59d18b025637a3aa043b91817739554f4ed2026cf8022dbd83e351ce1fabc272841d2510a01' },
  { txinIndex: 4, hashType: 0, expectedSigHash: '4f900a0bae3f1446fd48490c2958b5a023228f01661cda3496a11da502a7f7ef', expectedWitness: 'b4010dd48a617db09926f729e79c33ae0b4e94b79f04a1ae93ede6315eb3669de185a17d2b0ac9ee09fd4c64b678a0b61a0a86fa888a273c8511be83bfd6810f' },
  { txinIndex: 6, hashType: 2, expectedSigHash: '15f25c298eb5cdc7eb1d638dd2d45c97c4c59dcaec6679cfc16ad84f30876b85', expectedWitness: 'a3785919a2ce3c4ce26f298c3d51619bc474ae24014bcdd31328cd8cfbab2eff3395fa0a16fe5f486d12f22a9cedded5ae74feb4bbe5351346508c5405bcfee002' },
  { txinIndex: 7, hashType: 130, expectedSigHash: 'cd292de50313804dabe4685e83f923d2969577191a3e1d2882220dca88cbeb10', expectedWitness: 'ea0c6ba90763c2d3a296ad82ba45881abb4f426b3f87af162dd24d5109edc1cdd11915095ba47c3a9963dc1e6c432939872bc49212fe34c632cd3ab9fed429c482' },
  { txinIndex: 8, hashType: 129, expectedSigHash: 'cccb739eca6c13a8a89e6e5cd317ffe55669bbda23f2fd37b0f18755e008edd2', expectedWitness: 'bbc9584a11074e83bc8c6759ec55401f0ae7b03ef290c3139814f545b58a9f8127258000874f44bc46db7646322107d4d86aec8e73b8719a61fff761d75b5dd981' },
];
