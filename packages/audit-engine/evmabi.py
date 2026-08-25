# -*- coding: utf-8 -*-
"""Минимум ABI без web3: keccak256, селекторы, кодирование/декодирование.

Зачем своё. web3/eth-abi тянут за собой десятки зависимостей и версионный
ад; на этой машине их нет, а ставить ради четырёх байт селектора — не наш
масштаб. Здесь ровно столько, сколько нужно инструментам сравнения: посчитать
селектор по сигнатуре, закодировать простые аргументы, разобрать простой
результат. Ничего динамического сверх string/bytes.
"""

# --- keccak-256 (чистый Python, из спецификации Keccak-f[1600]) ----------

_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROT = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
]
_MASK = (1 << 64) - 1


def _rotl(x, n):
    return ((x << n) | (x >> (64 - n))) & _MASK


def _keccak_f(st):
    for rnd in range(24):
        # theta
        c = [st[x][0] ^ st[x][1] ^ st[x][2] ^ st[x][3] ^ st[x][4]
             for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                st[x][y] ^= d[x]
        # rho + pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl(st[x][y], _ROT[x][y])
        # chi
        for x in range(5):
            for y in range(5):
                st[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y])
        # iota
        st[0][0] ^= _RC[rnd]
    return st


def keccak256(data):
    if isinstance(data, str):
        data = data.encode()
    rate = 136                      # 1088 бит для keccak-256
    st = [[0] * 5 for _ in range(5)]
    # паддинг: 0x01 ... 0x80 (Keccak, НЕ SHA3)
    msg = bytearray(data)
    msg.append(0x01)
    while len(msg) % rate != 0:
        msg.append(0x00)
    msg[-1] ^= 0x80
    for off in range(0, len(msg), rate):
        block = msg[off:off + rate]
        for i in range(rate // 8):
            lane = int.from_bytes(block[i * 8:i * 8 + 8], "little")
            st[i % 5][i // 5] ^= lane
        _keccak_f(st)
    out = bytearray()
    for i in range(4):              # 32 байта = 4 полосы
        out += st[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out[:32])


def selector(sig):
    """4-байтовый селектор по сигнатуре, напр. 'peers(uint32)'."""
    return "0x" + keccak256(sig).hex()[:8]


# --- кодирование простых аргументов --------------------------------------

def enc_arg(typ, val):
    t = typ.strip()
    if t == "address":
        return int(val, 16).to_bytes(32, "big").hex()
    if t.startswith("uint") or t.startswith("int"):
        return int(val).to_bytes(32, "big").hex()
    if t == "bool":
        return (1 if val in (True, "true", "1", 1) else 0).to_bytes(32, "big").hex()
    if t.startswith("bytes") and t != "bytes":
        b = bytes.fromhex(val[2:] if val.startswith("0x") else val)
        return (b + b"\x00" * 32)[:32].hex()
    raise ValueError("не умею кодировать аргумент типа %s" % t)


def calldata(sig, args=()):
    data = selector(sig)
    for (typ, val) in args:
        data += enc_arg(typ, val)
    return data


# --- разбор простого результата ------------------------------------------

def dec_ret(typ, hexstr):
    if not hexstr or hexstr == "0x":
        return None
    raw = hexstr[2:] if hexstr.startswith("0x") else hexstr
    t = typ.strip()
    try:
        if t == "address":
            return "0x" + raw[24:64]
        if t == "bool":
            return int(raw[:64], 16) == 1
        if t.startswith("uint") or t.startswith("int"):
            return int(raw[:64], 16)
        if t == "bytes32":
            return "0x" + raw[:64]
        if t == "string" or t == "bytes":
            n = int(raw[64:128], 16)
            body = raw[128:128 + n * 2]
            b = bytes.fromhex(body)
            return b.decode("utf-8", "replace") if t == "string" else "0x" + body
    except Exception:
        return None
    return "0x" + raw[:64]
