import { describe, it, expect } from 'vitest';
import { MSPProtocol } from './MSPProtocol';
import { MSP_PROTOCOL } from './types';
import {
  buildMSPv1Response,
  buildMSPv1ErrorResponse,
  buildMSPJumboResponse,
} from './test/mspResponseFactory';

describe('MSPProtocol', () => {
  const protocol = new MSPProtocol();

  // ─── encode() standard MSPv1 ────────────────────────────────────

  describe('encode', () => {
    it('encodes empty payload message', () => {
      const result = protocol.encode(112); // MSP_PID
      expect(result.length).toBe(6);
      expect(result[0]).toBe(0x24); // '$'
      expect(result[1]).toBe(0x4d); // 'M'
      expect(result[2]).toBe(0x3c); // '<'
      expect(result[3]).toBe(0); // size = 0
      expect(result[4]).toBe(112); // command
      expect(result[5]).toBe(0 ^ 112); // checksum = size ^ command
    });

    it('encodes message with payload', () => {
      const data = Buffer.from([0x01, 0x02, 0x03]);
      const result = protocol.encode(202, data); // MSP_SET_PID

      expect(result.length).toBe(6 + 3);
      expect(result[3]).toBe(3); // size
      expect(result[4]).toBe(202); // command
      expect(result[5]).toBe(0x01);
      expect(result[6]).toBe(0x02);
      expect(result[7]).toBe(0x03);

      // Checksum: size ^ command ^ data bytes
      const expectedChecksum = 3 ^ 202 ^ 0x01 ^ 0x02 ^ 0x03;
      expect(result[8]).toBe(expectedChecksum);
    });

    it('encodes all 256 command codes correctly', () => {
      for (let code = 0; code < 256; code++) {
        const result = protocol.encode(code);
        expect(result[0]).toBe(0x24);
        expect(result[1]).toBe(0x4d);
        expect(result[2]).toBe(0x3c);
        expect(result[3]).toBe(0);
        expect(result[4]).toBe(code);
        expect(result[5]).toBe(code); // checksum = 0 ^ code = code
      }
    });

    it('encodes maximum standard payload (254 bytes)', () => {
      const data = Buffer.alloc(254);
      for (let i = 0; i < 254; i++) data[i] = i & 0xff;

      const result = protocol.encode(1, data);
      expect(result.length).toBe(6 + 254);
      expect(result[3]).toBe(254);
    });

    it('auto-switches to jumbo frame for payload >= 255 bytes', () => {
      const data = Buffer.alloc(255);
      const result = protocol.encode(1, data);

      // Jumbo frame format
      expect(result[3]).toBe(0xff); // jumbo flag
      expect(result.readUInt16LE(4)).toBe(255); // 16-bit size
    });

    it('encodes jumbo frame with large payload', () => {
      const data = Buffer.alloc(500);
      for (let i = 0; i < 500; i++) data[i] = i & 0xff;

      const result = protocol.encode(71, data); // MSP_DATAFLASH_READ
      expect(result.length).toBe(8 + 500);
      expect(result[3]).toBe(0xff);
      expect(result.readUInt16LE(4)).toBe(500);
      expect(result[6]).toBe(71);
    });

    it('throws MSPError for oversized jumbo payload', () => {
      const data = Buffer.alloc(MSP_PROTOCOL.MAX_JUMBO_PAYLOAD_SIZE + 1);
      expect(() => protocol.encode(1, data)).toThrow('Jumbo payload too large');
    });
  });

  // ─── decode() standard MSPv1 ────────────────────────────────────

  describe('decode', () => {
    it('decodes valid response with no data', () => {
      const frame = buildMSPv1Response(112, []);
      const result = protocol.decode(frame);

      expect(result).not.toBeNull();
      expect(result!.command).toBe(112);
      expect(result!.data.length).toBe(0);
      expect(result!.error).toBe(false);
    });

    it('decodes valid response with data', () => {
      const payload = [45, 67, 23, 45, 67, 23, 30, 50, 20];
      const frame = buildMSPv1Response(112, payload);
      const result = protocol.decode(frame);

      expect(result).not.toBeNull();
      expect(result!.command).toBe(112);
      expect(result!.data.length).toBe(9);
      expect(result!.data[0]).toBe(45);
      expect(result!.data[8]).toBe(20);
    });

    it('decodes error response (direction byte = !)', () => {
      const frame = buildMSPv1ErrorResponse(202);
      const result = protocol.decode(frame);

      expect(result).not.toBeNull();
      expect(result!.command).toBe(202);
      expect(result!.error).toBe(true);
    });

    it('returns null for incomplete buffer (< 6 bytes)', () => {
      const buf = Buffer.from([0x24, 0x4d, 0x3e]);
      expect(protocol.decode(buf)).toBeNull();
    });

    it('returns null for incomplete payload (header present but data short)', () => {
      // Header says size=10 but we only have 3 bytes of data
      const buf = Buffer.alloc(9);
      buf[0] = 0x24;
      buf[1] = 0x4d;
      buf[2] = 0x3e;
      buf[3] = 10; // size = 10
      buf[4] = 1; // command
      // Only 4 bytes after header, need 10 + checksum = 11
      expect(protocol.decode(buf)).toBeNull();
    });

    it('throws on invalid preamble', () => {
      const buf = Buffer.from([0x00, 0x00, 0x3e, 0x00, 0x01, 0x01]);
      expect(() => protocol.decode(buf)).toThrow('Invalid MSP preamble');
    });

    it('throws on invalid direction byte', () => {
      const buf = Buffer.from([0x24, 0x4d, 0x3c, 0x00, 0x01, 0x01]); // '<' = to FC, not from FC
      expect(() => protocol.decode(buf)).toThrow('Invalid MSP direction');
    });

    it('throws on checksum mismatch', () => {
      const frame = buildMSPv1Response(1, [0x42]);
      frame[frame.length - 1] ^= 0xff; // corrupt checksum
      expect(() => protocol.decode(frame)).toThrow('Checksum mismatch');
    });

    it('decodes zero-length response correctly', () => {
      const frame = buildMSPv1Response(72, []); // MSP_DATAFLASH_ERASE ack
      const result = protocol.decode(frame);
      expect(result).not.toBeNull();
      expect(result!.data.length).toBe(0);
    });
  });

  // ─── decode() jumbo frames ──────────────────────────────────────

  describe('decode jumbo', () => {
    it('decodes valid jumbo frame response', () => {
      const payload = Buffer.alloc(300);
      for (let i = 0; i < 300; i++) payload[i] = i & 0xff;

      const frame = buildMSPJumboResponse(71, payload);
      const result = protocol.decode(frame);

      expect(result).not.toBeNull();
      expect(result!.command).toBe(71);
      expect(result!.data.length).toBe(300);
      expect(Buffer.compare(result!.data, payload)).toBe(0);
    });

    it('returns null for incomplete jumbo buffer (< 8 bytes)', () => {
      const buf = Buffer.from([0x24, 0x4d, 0x3e, 0xff, 0x00, 0x01, 0x01]);
      expect(protocol.decode(buf)).toBeNull();
    });

    it('returns null for incomplete jumbo payload', () => {
      // Header says 500 bytes but buffer is too short
      const buf = Buffer.alloc(20);
      buf[0] = 0x24;
      buf[1] = 0x4d;
      buf[2] = 0x3e;
      buf[3] = 0xff;
      buf.writeUInt16LE(500, 4);
      buf[6] = 71;
      expect(protocol.decode(buf)).toBeNull();
    });

    it('throws on jumbo frame checksum mismatch', () => {
      const payload = Buffer.from([0x01, 0x02, 0x03]);
      const frame = buildMSPJumboResponse(71, payload);
      frame[frame.length - 1] ^= 0xff; // corrupt checksum
      expect(() => protocol.decode(frame)).toThrow('Jumbo frame checksum mismatch');
    });
  });

  // ─── encode/decode round-trip ───────────────────────────────────

  describe('round-trip', () => {
    it('encode → build response → decode produces matching command and data', () => {
      const data = Buffer.from([10, 20, 30, 40, 50]);
      const encoded = protocol.encode(112, data);

      // Build a response with same command and data
      const response = buildMSPv1Response(112, data);
      const decoded = protocol.decode(response);

      expect(decoded).not.toBeNull();
      expect(decoded!.command).toBe(112);
      expect(Buffer.compare(decoded!.data, data)).toBe(0);

      // Verify the encoded request has correct structure
      expect(encoded[4]).toBe(112); // command matches
      expect(encoded[3]).toBe(5); // size matches
    });

    it('round-trip works for all command codes with random payload', () => {
      for (let code = 0; code < 256; code++) {
        const payload = Buffer.alloc(4);
        payload.writeUInt32LE(code * 1000, 0);

        const response = buildMSPv1Response(code, payload);
        const decoded = protocol.decode(response);

        expect(decoded).not.toBeNull();
        expect(decoded!.command).toBe(code);
        expect(decoded!.data.length).toBe(4);
      }
    });

    it('round-trip works for jumbo frames', () => {
      const data = Buffer.alloc(500);
      for (let i = 0; i < 500; i++) data[i] = (i * 7) & 0xff;

      const response = buildMSPJumboResponse(71, data);
      const decoded = protocol.decode(response);

      expect(decoded).not.toBeNull();
      expect(decoded!.command).toBe(71);
      expect(Buffer.compare(decoded!.data, data)).toBe(0);
    });
  });

  // ─── parseBuffer() ──────────────────────────────────────────────

  describe('parseBuffer', () => {
    it('parses single message from buffer', () => {
      const frame = buildMSPv1Response(1, [0, 1, 44]);
      const { messages, remaining } = protocol.parseBuffer(frame);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(1);
      expect(remaining.length).toBe(0);
    });

    it('parses multiple messages from single buffer', () => {
      const frame1 = buildMSPv1Response(1, [0, 1, 44]);
      const frame2 = buildMSPv1Response(2, Buffer.from('BTFL'));
      const combined = Buffer.concat([frame1, frame2]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(2);
      expect(messages[0].command).toBe(1);
      expect(messages[1].command).toBe(2);
      expect(remaining.length).toBe(0);
    });

    it('returns remaining bytes for incomplete trailing message', () => {
      const frame = buildMSPv1Response(1, [0, 1, 44]);
      const partial = Buffer.from([0x24, 0x4d, 0x3e]); // incomplete second message
      const combined = Buffer.concat([frame, partial]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(1);
      expect(remaining.length).toBe(3);
    });

    it('returns empty messages for empty buffer', () => {
      const { messages, remaining } = protocol.parseBuffer(Buffer.alloc(0));
      expect(messages.length).toBe(0);
      expect(remaining.length).toBe(0);
    });

    it('skips garbage bytes before valid message', () => {
      const garbage = Buffer.from([0x00, 0xff, 0x42]);
      const frame = buildMSPv1Response(3, [4, 5, 1]);
      const combined = Buffer.concat([garbage, frame]);

      const { messages } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(3);
    });

    it('handles corrupted message followed by valid message', () => {
      // Corrupt frame: valid preamble but bad checksum
      const corrupt = buildMSPv1Response(1, [0]);
      corrupt[corrupt.length - 1] ^= 0xff;

      const valid = buildMSPv1Response(2, Buffer.from('BTFL'));
      const combined = Buffer.concat([corrupt, valid]);

      const { messages } = protocol.parseBuffer(combined);

      // Should skip the corrupt frame and find the valid one
      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(2);
    });

    it('returns only remaining for buffer with no preamble', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const { messages, remaining } = protocol.parseBuffer(buf);
      expect(messages.length).toBe(0);
      // No preamble found, so offset stays at 0 but loop breaks
    });
  });

  // ─── parseBuffer() jumbo frame support ──────────────────────────

  describe('parseBuffer jumbo frames', () => {
    it('parses single jumbo frame from buffer', () => {
      const payload = Buffer.alloc(300);
      for (let i = 0; i < 300; i++) payload[i] = i & 0xff;
      const frame = buildMSPJumboResponse(71, payload);

      const { messages, remaining } = protocol.parseBuffer(frame);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(71);
      expect(messages[0].data.length).toBe(300);
      expect(Buffer.compare(messages[0].data, payload)).toBe(0);
      expect(remaining.length).toBe(0);
    });

    it('parses standard frame followed by jumbo frame', () => {
      const stdPayload = Buffer.from([0x01, 0x02, 0x03]);
      const jumboPayload = Buffer.alloc(400);
      for (let i = 0; i < 400; i++) jumboPayload[i] = (i * 3) & 0xff;

      const stdFrame = buildMSPv1Response(1, stdPayload);
      const jumboFrame = buildMSPJumboResponse(71, jumboPayload);
      const combined = Buffer.concat([stdFrame, jumboFrame]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(2);
      expect(messages[0].command).toBe(1);
      expect(messages[0].data.length).toBe(3);
      expect(messages[1].command).toBe(71);
      expect(messages[1].data.length).toBe(400);
      expect(Buffer.compare(messages[1].data, jumboPayload)).toBe(0);
      expect(remaining.length).toBe(0);
    });

    it('parses jumbo frame followed by standard frame', () => {
      const jumboPayload = Buffer.alloc(500);
      for (let i = 0; i < 500; i++) jumboPayload[i] = (i * 7) & 0xff;
      const stdPayload = Buffer.from([0xaa, 0xbb]);

      const jumboFrame = buildMSPJumboResponse(71, jumboPayload);
      const stdFrame = buildMSPv1Response(2, stdPayload);
      const combined = Buffer.concat([jumboFrame, stdFrame]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(2);
      expect(messages[0].command).toBe(71);
      expect(messages[0].data.length).toBe(500);
      expect(messages[1].command).toBe(2);
      expect(messages[1].data.length).toBe(2);
      expect(remaining.length).toBe(0);
    });

    it('parses multiple jumbo frames from single buffer', () => {
      const payload1 = Buffer.alloc(300);
      const payload2 = Buffer.alloc(600);
      for (let i = 0; i < 300; i++) payload1[i] = i & 0xff;
      for (let i = 0; i < 600; i++) payload2[i] = (i * 11) & 0xff;

      const frame1 = buildMSPJumboResponse(71, payload1);
      const frame2 = buildMSPJumboResponse(72, payload2);
      const combined = Buffer.concat([frame1, frame2]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(2);
      expect(messages[0].command).toBe(71);
      expect(messages[0].data.length).toBe(300);
      expect(messages[1].command).toBe(72);
      expect(messages[1].data.length).toBe(600);
      expect(remaining.length).toBe(0);
    });

    it('returns remaining bytes for incomplete trailing jumbo frame', () => {
      const stdFrame = buildMSPv1Response(1, [0x42]);
      // Build an incomplete jumbo frame (header only, no data)
      const incompleteJumbo = Buffer.alloc(8);
      incompleteJumbo[0] = 0x24;
      incompleteJumbo[1] = 0x4d;
      incompleteJumbo[2] = 0x3e;
      incompleteJumbo[3] = 0xff;
      incompleteJumbo.writeUInt16LE(500, 4); // claims 500 bytes
      incompleteJumbo[6] = 71;

      const combined = Buffer.concat([stdFrame, incompleteJumbo]);
      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(1);
      // Remaining should include the incomplete jumbo frame
      expect(remaining.length).toBe(8);
    });

    it('handles jumbo frame with size exactly 255 (boundary)', () => {
      const payload = Buffer.alloc(255);
      for (let i = 0; i < 255; i++) payload[i] = i & 0xff;

      const frame = buildMSPJumboResponse(71, payload);
      const { messages, remaining } = protocol.parseBuffer(frame);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(71);
      expect(messages[0].data.length).toBe(255);
      expect(remaining.length).toBe(0);
    });

    it('parses three mixed frames: standard + jumbo + standard', () => {
      const std1 = buildMSPv1Response(1, [0x10]);
      const jumbo = buildMSPJumboResponse(71, Buffer.alloc(1000, 0xab));
      const std2 = buildMSPv1Response(3, [0x20, 0x30]);
      const combined = Buffer.concat([std1, jumbo, std2]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(3);
      expect(messages[0].command).toBe(1);
      expect(messages[0].data.length).toBe(1);
      expect(messages[1].command).toBe(71);
      expect(messages[1].data.length).toBe(1000);
      expect(messages[2].command).toBe(3);
      expect(messages[2].data.length).toBe(2);
      expect(remaining.length).toBe(0);
    });

    it('handles garbage bytes before jumbo frame', () => {
      const garbage = Buffer.from([0x00, 0xff, 0x42, 0x13]);
      const jumboPayload = Buffer.alloc(300, 0xcc);
      const jumboFrame = buildMSPJumboResponse(71, jumboPayload);
      const combined = Buffer.concat([garbage, jumboFrame]);

      const { messages } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(71);
      expect(messages[0].data.length).toBe(300);
    });

    it('handles corrupted jumbo frame followed by valid standard frame', () => {
      // Build a jumbo frame with corrupted checksum
      const jumboPayload = Buffer.alloc(300, 0xdd);
      const corruptJumbo = buildMSPJumboResponse(71, jumboPayload);
      corruptJumbo[corruptJumbo.length - 1] ^= 0xff; // corrupt checksum

      const validStd = buildMSPv1Response(2, [0x42]);
      const combined = Buffer.concat([corruptJumbo, validStd]);

      const { messages } = protocol.parseBuffer(combined);

      // Should skip the corrupt jumbo and find the valid standard frame
      expect(messages.length).toBe(1);
      expect(messages[0].command).toBe(2);
    });

    it('verifies data integrity across multiple jumbo frames', () => {
      // Simulate a blackbox download: multiple 4096-byte flash reads
      const chunk1 = Buffer.alloc(4096);
      const chunk2 = Buffer.alloc(4096);
      for (let i = 0; i < 4096; i++) {
        chunk1[i] = i & 0xff;
        chunk2[i] = (i + 128) & 0xff;
      }

      const frame1 = buildMSPJumboResponse(71, chunk1);
      const frame2 = buildMSPJumboResponse(71, chunk2);
      const combined = Buffer.concat([frame1, frame2]);

      const { messages, remaining } = protocol.parseBuffer(combined);

      expect(messages.length).toBe(2);
      expect(messages[0].data.length).toBe(4096);
      expect(messages[1].data.length).toBe(4096);
      // Verify each byte is correct
      expect(messages[0].data[0]).toBe(0);
      expect(messages[0].data[255]).toBe(255);
      expect(messages[0].data[4095]).toBe(4095 & 0xff);
      expect(messages[1].data[0]).toBe(128);
      expect(messages[1].data[4095]).toBe((4095 + 128) & 0xff);
      expect(remaining.length).toBe(0);
    });
  });
});
