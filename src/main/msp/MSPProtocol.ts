import { MSPMessage, MSPResponse, MSP_PROTOCOL } from './types';
import { MSPError } from '../utils/errors';

export class MSPProtocol {
  /**
   * Encode MSP message to send to FC
   * Automatically uses jumbo frames (MSPv2) for payloads > 255 bytes
   */
  encode(command: number, data: Buffer = Buffer.alloc(0)): Buffer {
    const size = data.length;

    // Use jumbo frames for large payloads
    if (size >= MSP_PROTOCOL.JUMBO_FRAME_MIN_SIZE) {
      return this.encodeJumbo(command, data);
    }

    // Standard MSP v1 encoding
    if (size > MSP_PROTOCOL.MAX_PAYLOAD_SIZE) {
      throw new MSPError(`Payload too large: ${size} > ${MSP_PROTOCOL.MAX_PAYLOAD_SIZE}`);
    }

    const buffer = Buffer.alloc(6 + size);

    buffer[0] = MSP_PROTOCOL.PREAMBLE1; // '$'
    buffer[1] = MSP_PROTOCOL.PREAMBLE2; // 'M'
    buffer[2] = MSP_PROTOCOL.DIRECTION_TO_FC; // '<'
    buffer[3] = size; // payload size (1 byte)
    buffer[4] = command; // command ID

    // Copy payload
    if (size > 0) {
      data.copy(buffer, 5);
    }

    // Calculate checksum (XOR of size, command, and all data bytes)
    let checksum = size ^ command;
    for (let i = 0; i < size; i++) {
      checksum ^= data[i];
    }
    buffer[5 + size] = checksum;

    return buffer;
  }

  /**
   * Encode MSP jumbo frame message (MSPv2 over MSPv1)
   * Format: $X<0xFF flag><size 16-bit LE><command><data><checksum>
   */
  private encodeJumbo(command: number, data: Buffer): Buffer {
    const size = data.length;

    if (size > MSP_PROTOCOL.MAX_JUMBO_PAYLOAD_SIZE) {
      throw new MSPError(
        `Jumbo payload too large: ${size} > ${MSP_PROTOCOL.MAX_JUMBO_PAYLOAD_SIZE}`
      );
    }

    // Jumbo frame: preamble + 0xFF flag + 2-byte size + command + data + checksum
    const buffer = Buffer.alloc(8 + size);

    buffer[0] = MSP_PROTOCOL.PREAMBLE1; // '$'
    buffer[1] = MSP_PROTOCOL.PREAMBLE2; // 'M'
    buffer[2] = MSP_PROTOCOL.DIRECTION_TO_FC; // '<'
    buffer[3] = 0xff; // Jumbo frame flag
    buffer.writeUInt16LE(size, 4); // 16-bit size (little-endian)
    buffer[6] = command; // command ID

    // Copy payload
    if (size > 0) {
      data.copy(buffer, 7);
    }

    // Calculate checksum for jumbo frame (different from v1!)
    // Checksum = CRC8 of size_low ^ size_high ^ command ^ data
    let checksum = (size & 0xff) ^ (size >> 8) ^ command;
    for (let i = 0; i < size; i++) {
      checksum ^= data[i];
    }
    buffer[7 + size] = checksum;

    return buffer;
  }

  /**
   * Decode MSP response from FC
   * Handles both standard MSP v1 and jumbo frames (MSPv2)
   */
  decode(buffer: Buffer): MSPResponse | null {
    if (buffer.length < 6) {
      return null; // Incomplete message
    }

    // Check preamble
    if (buffer[0] !== MSP_PROTOCOL.PREAMBLE1 || buffer[1] !== MSP_PROTOCOL.PREAMBLE2) {
      throw new MSPError('Invalid MSP preamble');
    }

    const direction = buffer[2];
    const isError = direction === MSP_PROTOCOL.ERROR;

    if (direction !== MSP_PROTOCOL.DIRECTION_FROM_FC && !isError) {
      throw new MSPError(`Invalid MSP direction: 0x${direction.toString(16)}`);
    }

    // Check if this is a jumbo frame (flag = 0xFF)
    const sizeOrFlag = buffer[3];
    if (sizeOrFlag === 0xff) {
      return this.decodeJumbo(buffer);
    }

    // Standard MSP v1 decoding
    const size = sizeOrFlag;
    const command = buffer[4];

    // Check if we have complete message
    if (buffer.length < 6 + size) {
      return null; // Incomplete message
    }

    // Extract data
    const data = buffer.slice(5, 5 + size);

    // Verify checksum
    const receivedChecksum = buffer[5 + size];
    let calculatedChecksum = size ^ command;
    for (let i = 0; i < size; i++) {
      calculatedChecksum ^= data[i];
    }

    if (receivedChecksum !== calculatedChecksum) {
      throw new MSPError(
        `Checksum mismatch: received 0x${receivedChecksum.toString(16)}, calculated 0x${calculatedChecksum.toString(16)}`
      );
    }

    return {
      command,
      data,
      error: isError,
    };
  }

  /**
   * Decode MSP jumbo frame response (MSPv2 over MSPv1)
   * Format: $X>0xFF<size 16-bit LE><command><data><checksum>
   */
  private decodeJumbo(buffer: Buffer): MSPResponse | null {
    if (buffer.length < 8) {
      return null; // Incomplete jumbo message
    }

    // Read 16-bit size (little-endian)
    const size = buffer.readUInt16LE(4);
    const command = buffer[6];

    // Check if we have complete message
    if (buffer.length < 8 + size) {
      return null; // Incomplete message
    }

    // Extract data
    const data = buffer.slice(7, 7 + size);

    // Verify checksum
    const receivedChecksum = buffer[7 + size];
    let calculatedChecksum = (size & 0xff) ^ (size >> 8) ^ command;
    for (let i = 0; i < size; i++) {
      calculatedChecksum ^= data[i];
    }

    if (receivedChecksum !== calculatedChecksum) {
      throw new MSPError(
        `Jumbo frame checksum mismatch: received 0x${receivedChecksum.toString(16)}, calculated 0x${calculatedChecksum.toString(16)}`
      );
    }

    return {
      command,
      data,
      error: false,
    };
  }

  /**
   * Parse multiple messages from buffer
   */
  parseBuffer(buffer: Buffer): { messages: MSPResponse[]; remaining: Buffer } {
    const messages: MSPResponse[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      // Find preamble
      let preambleIndex = -1;
      for (let i = offset; i < buffer.length - 1; i++) {
        if (buffer[i] === MSP_PROTOCOL.PREAMBLE1 && buffer[i + 1] === MSP_PROTOCOL.PREAMBLE2) {
          preambleIndex = i;
          break;
        }
      }

      if (preambleIndex === -1) {
        // No more messages
        break;
      }

      offset = preambleIndex;

      // Try to decode message
      try {
        const message = this.decode(buffer.slice(offset));
        if (message) {
          messages.push(message);
          // Advance past the decoded message — jumbo frames have a different layout
          const sizeOrFlag = buffer[offset + 3];
          if (sizeOrFlag === 0xff) {
            // Jumbo frame: $M>0xFF<size_lo><size_hi><cmd><data><crc> = 8 + payload
            const jumboSize = buffer.readUInt16LE(offset + 4);
            offset += 8 + jumboSize;
          } else {
            // Standard frame: $M><size><cmd><data><crc> = 6 + payload
            offset += 6 + sizeOrFlag;
          }
        } else {
          // Incomplete message, save remaining
          break;
        }
      } catch (error) {
        // Invalid message, skip preamble and continue
        offset += 2;
      }
    }

    return {
      messages,
      remaining: buffer.slice(offset),
    };
  }
}
