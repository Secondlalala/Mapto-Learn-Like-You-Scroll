import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';

export interface DecodedBook {
  text: string;
  encoding: string;
}

interface Utf8Decoder {
  decode(input: Uint8Array): string;
}

type Utf8DecoderConstructor = new (encoding: string, options: {fatal: boolean}) => Utf8Decoder;

function removeByteOrderMark(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function toBinaryString(bytes: Uint8Array): string {
  return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}

export function decodeBook(bytes: Uint8Array): DecodedBook {
  try {
    const TextDecoderConstructor = (globalThis as unknown as {TextDecoder?: Utf8DecoderConstructor}).TextDecoder;
    if (!TextDecoderConstructor) {
      throw new Error('UTF-8 decoder is unavailable');
    }
    return {
      text: removeByteOrderMark(new TextDecoderConstructor('utf-8', {fatal: true}).decode(bytes)),
      encoding: 'utf-8',
    };
  } catch {
    const detected = jschardet.detect(toBinaryString(bytes));
    const encoding = detected.encoding?.toLowerCase();
    if (!encoding || !iconv.encodingExists(encoding)) {
      throw new Error('Unable to decode book text');
    }
    return {text: removeByteOrderMark(iconv.decode(bytes, encoding)), encoding};
  }
}
