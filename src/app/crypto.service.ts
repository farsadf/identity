import { Injectable } from '@angular/core';
import HDNode from 'hdkey';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import {ec as EC} from 'elliptic';
import bs58check from 'bs58check';
import {CookieService} from 'ngx-cookie';
import {createCipher, createDecipher, randomBytes} from 'crypto';
import {Network} from '../types/identity';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {

  constructor(private cookieService: CookieService) {
  }

  static PUBLIC_KEY_PREFIXES = {
    mainnet: {
      bitcoin: [0x00],
      bitclout: [0xcd, 0x14, 0x0],
    },
    testnet: {
      bitcoin: [0x6f],
      bitclout: [0x11, 0xc2, 0x0],
    }
  };

  // Safari only lets us store things in cookies
  mustUseStorageAccess(): boolean {
    return typeof document.hasStorageAccess === 'function';
  }

  // 32 bytes = 256 bits is plenty of entropy for encryption
  newEncryptionKey(): string {
    return randomBytes(32).toString('hex');
  }

  seedHexEncryptionKey(hostname: string): string {
    const storageKey = `seed-hex-key-${hostname}`;
    let encryptionKey;

    if (this.mustUseStorageAccess()) {
      encryptionKey = this.cookieService.get(storageKey);
      if (!encryptionKey) {
        encryptionKey = this.newEncryptionKey();
        this.cookieService.put(storageKey, encryptionKey, {
          expires: new Date('2100/01/01 00:00:00'),
        });
      }
    } else {
      encryptionKey = localStorage.getItem(storageKey) || '';
      if (!encryptionKey) {
        encryptionKey = this.newEncryptionKey();
        localStorage.setItem(storageKey, encryptionKey);
      }
    }

    // If the encryption key is unset or malformed we need to stop
    // everything to avoid returning unencrypted information.
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error('Failed to load or generate encryption key; this should never happen');
    }

    return encryptionKey;
  }

  encryptSeedHex(seedHex: string, hostname: string): string {
    const encryptionKey = this.seedHexEncryptionKey(hostname);
    const cipher = createCipher('aes-256-gcm', encryptionKey);
    return cipher.update(seedHex).toString('hex');
  }

  decryptSeedHex(encryptedSeedHex: string, hostname: string): string {
    const encryptionKey = this.seedHexEncryptionKey(hostname);
    const decipher = createDecipher('aes-256-gcm', encryptionKey);
    return decipher.update(Buffer.from(encryptedSeedHex, 'hex')).toString();
  }

  encryptedSeedHexToPrivateKey(encryptedSeedHex: string, domain: string): EC.KeyPair {
    const seedHex = this.decryptSeedHex(encryptedSeedHex, domain);
    return this.seedHexToPrivateKey(seedHex);
  }

  uintToBuf(uint: number): Buffer {
    const result = [];

    while (uint >= 0x80) {
      result.push((uint & 0xFF) | 0x80);
      uint >>>= 7;
    }

    result.push(uint | 0);

    return new Buffer(result);
  }

  mnemonicToKeychain(mnemonic: string, extraText?: string): HDNode {
    const seed = bip39.mnemonicToSeedSync(mnemonic, extraText);
    return HDKey.fromMasterSeed(seed).derive('m/44\'/0\'/0\'/0/0');
  }

  keychainToSeedHex(keychain: HDNode): string {
    return keychain.privateKey.toString('hex');
  }

  seedHexToPrivateKey(seedHex: string): EC.KeyPair {
    const ec = new EC('secp256k1');
    return ec.keyFromPrivate(seedHex);
  }

   privateKeyToBitcloutPublicKey(privateKey: EC.KeyPair, network: Network): string {
    const prefix = CryptoService.PUBLIC_KEY_PREFIXES[network].bitclout;
    const key = privateKey.getPublic().encode('array', true);
    const prefixAndKey = Uint8Array.from([...prefix, ...key]);

    return bs58check.encode(prefixAndKey);
  }

  keychainToBtcAddress(keychain: HDNode, network: Network): string {
    const prefix = CryptoService.PUBLIC_KEY_PREFIXES[network].bitcoin;
    // @ts-ignore TODO: add "identifier" to type definition
    const identifier = keychain.identifier;
    const prefixAndKey = Uint8Array.from([...prefix, ...identifier]);

    return bs58check.encode(prefixAndKey);
  }
}
