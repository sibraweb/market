"""
server_hist.py — Servidor de precios históricos para SIBRA Seguimiento
======================================================================
Ejecutar en 192.168.1.94:
    pip install flask flask-cors yfinance
    python server_hist.py

Endpoint: GET /api/historical?symbol=GGAL.BA&period=10y
La app usa este server cuando configuras "Servidor local" → http://192.168.1.94:5051
"""

import sqlite3, json, os, time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
import yfinance as yf

app = Flask(__name__)
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), 'prices.db')

# ── DB ──────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS prices (
                symbol  TEXT    NOT NULL,
                date    TEXT    NOT NULL,
                open    REAL,
                high    REAL,
                low     REAL,
                close   REAL    NOT NULL,
                volume  INTEGER,
                PRIMARY KEY (symbol, date)
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS sync_log (
                symbol      TEXT PRIMARY KEY,
                last_sync   TEXT NOT NULL,
                row_count   INTEGER
            )
        ''')
        db.commit()

# ── FETCH & CACHE ────────────────────────────────────────────────────────
def needs_refresh(symbol: str, max_age_hours: int = 4) -> bool:
    with get_db() as db:
        row = db.execute('SELECT last_sync FROM sync_log WHERE symbol = ?', (symbol,)).fetchone()
        if not row:
            return True
        last = datetime.fromisoformat(row['last_sync'])
        return (datetime.utcnow() - last).total_seconds() > max_age_hours * 3600

def fetch_and_store(symbol: str, period: str = '10y'):
    print(f'[{datetime.now():%H:%M:%S}] Fetching {symbol} period={period}…')
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval='1d', auto_adjust=True)

    if hist.empty:
        raise ValueError(f'No data returned for {symbol}')

    rows = []
    for dt, row in hist.iterrows():
        rows.append((
            symbol,
            dt.strftime('%Y-%m-%d'),
            round(float(row['Open']),   4) if row['Open']   == row['Open'] else None,
            round(float(row['High']),   4) if row['High']   == row['High'] else None,
            round(float(row['Low']),    4) if row['Low']    == row['Low']  else None,
            round(float(row['Close']),  4),
            int(row['Volume']) if row['Volume'] == row['Volume'] else 0,
        ))

    with get_db() as db:
        db.executemany('''
            INSERT OR REPLACE INTO prices (symbol, date, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', rows)
        db.execute('''
            INSERT OR REPLACE INTO sync_log (symbol, last_sync, row_count)
            VALUES (?, ?, ?)
        ''', (symbol, datetime.utcnow().isoformat(), len(rows)))
        db.commit()

    print(f'[{datetime.now():%H:%M:%S}] Stored {len(rows)} rows for {symbol}')
    return len(rows)

def load_from_db(symbol: str):
    with get_db() as db:
        rows = db.execute(
            'SELECT date, open, high, low, close, volume FROM prices WHERE symbol = ? ORDER BY date',
            (symbol,)
        ).fetchall()
    return [{
        't': int(datetime.strptime(r['date'], '%Y-%m-%d').timestamp() * 1000),
        'o': r['open']  or r['close'],
        'h': r['high']  or r['close'],
        'l': r['low']   or r['close'],
        'c': r['close'],
        'v': r['volume'] or 0,
    } for r in rows]

# ── ENDPOINTS ────────────────────────────────────────────────────────────
@app.route('/api/historical')
def historical():
    symbol = request.args.get('symbol', '').strip().upper()
    period = request.args.get('period', '10y')

    if not symbol:
        return jsonify({'error': 'symbol requerido'}), 400

    try:
        if needs_refresh(symbol):
            fetch_and_store(symbol, period)
        data = load_from_db(symbol)
        if not data:
            return jsonify({'error': f'Sin datos para {symbol}'}), 404
        return jsonify({'symbol': symbol, 'count': len(data), 'data': data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/refresh', methods=['POST'])
def refresh():
    """Forzar re-descarga de uno o varios símbolos. Body: {"symbols":["GGAL.BA","YPFD.BA"]}"""
    body = request.get_json(silent=True) or {}
    symbols = body.get('symbols', [])
    if not symbols:
        return jsonify({'error': 'symbols requerido'}), 400
    results = {}
    for sym in symbols:
        try:
            n = fetch_and_store(sym)
            results[sym] = {'ok': True, 'rows': n}
        except Exception as e:
            results[sym] = {'ok': False, 'error': str(e)}
    return jsonify(results)

@app.route('/api/status')
def status():
    with get_db() as db:
        rows = db.execute('SELECT symbol, last_sync, row_count FROM sync_log ORDER BY symbol').fetchall()
    return jsonify({'db': DB_PATH, 'symbols': [dict(r) for r in rows]})

@app.route('/')
def index():
    return '<h3>SIBRA · server_hist corriendo</h3><a href="/api/status">/api/status</a>'

# ── MAIN ─────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    print(f'Base de datos: {DB_PATH}')
    print('Endpoints:')
    print('  GET  /api/historical?symbol=GGAL.BA&period=10y')
    print('  POST /api/refresh   body: {"symbols":["GGAL.BA"]}')
    print('  GET  /api/status')
    app.run(host='0.0.0.0', port=5051, debug=False)
