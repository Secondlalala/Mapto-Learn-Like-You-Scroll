import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import {decodeBook} from '../textDecoder';

describe('decodeBook', () => {
  it('preserves valid UTF-8 Chinese text without invoking encoding detection', () => {
    const detect = jest.spyOn(jschardet, 'detect');
    const bytes = new Uint8Array([
      0xe7, 0xac, 0xac, 0xe4, 0xb8, 0x80, 0xe7, 0xab, 0xa0, 0xef, 0xbc, 0x9a, 0xe4, 0xbd, 0xa0,
      0xe5, 0xa5, 0xbd, 0xef, 0xbc, 0x8c, 0xe4, 0xb8, 0x96, 0xe7, 0x95, 0x8c,
    ]);

    expect(decodeBook(bytes)).toEqual({text: '第一章：你好，世界', encoding: 'utf-8'});
    expect(detect).not.toHaveBeenCalled();
    detect.mockRestore();
  });

  it('uses the detected legacy encoding only after UTF-8 validation fails', () => {
    const legacyText = '这是一个用于字符编码检测的中文段落。你好，世界！我们需要确保内容能够被正确解码。';
    const result = decodeBook(new Uint8Array(iconv.encode(legacyText, 'gb18030')));

    expect(result.text).toBe(legacyText);
    expect(result.encoding).toMatch(/^gb/);
  });
});
