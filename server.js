const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const BASE_URL = 'https://fapi.binance.com';

function getSignature(queryString, apiSecret) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function makeBinanceRequest(endpoint, method, apiKey, apiSecret, extraParams = {}) {
    try {
        const timestamp = Date.now();
        const params = new URLSearchParams({ timestamp, ...extraParams });
        const signature = getSignature(params.toString(), apiSecret);
        params.append('signature', signature);

        const config = {
            method,
            url: `${BASE_URL}${endpoint}?${params.toString()}`,
            headers: {
                'X-MBX-APIKEY': apiKey,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        if (error.response) {
            throw error.response.data;
        }
        throw error.message;
    }
}

// 1. Account Info (Balance)
app.post('/api/account', async (req, res) => {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) return res.status(400).json({ error: 'Missing API credentials' });
    try {
        const data = await makeBinanceRequest('/fapi/v2/account', 'GET', apiKey, apiSecret);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error });
    }
});

// 2. Open Positions (Position Risk)
app.post('/api/positions', async (req, res) => {
    const { apiKey, apiSecret } = req.body;
    try {
        const data = await makeBinanceRequest('/fapi/v2/positionRisk', 'GET', apiKey, apiSecret);
        // Lọc các vị thế đang mở (positionAmt != 0)
        const openPositions = data.filter(p => parseFloat(p.positionAmt) !== 0);
        res.json(openPositions);
    } catch (error) {
        res.status(500).json({ error });
    }
});

app.post('/api/brackets', async (req, res) => {
    const { apiKey, apiSecret, symbol } = req.body;
    try {
        const data = await makeBinanceRequest('/fapi/v1/leverageBracket', 'GET', apiKey, apiSecret, { symbol });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error });
    }
});

// 3. Open Orders
app.post('/api/orders', async (req, res) => {
    const { apiKey, apiSecret } = req.body;
    try {
        const data = await makeBinanceRequest('/fapi/v1/openOrders', 'GET', apiKey, apiSecret);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error });
    }
});

// 4. Trade (Place Order)
app.post('/api/trade', async (req, res) => {
    const { apiKey, apiSecret, symbol, side, type, quantity, price, stopPrice, leverage } = req.body;
    try {
        // Change leverage first if requested
        if (leverage) {
             try {
                await makeBinanceRequest('/fapi/v1/leverage', 'POST', apiKey, apiSecret, { symbol, leverage });
             } catch(levErr) {
                console.log("Leverage changed error (might be same var): ", levErr);
             }
        }

        const params = { symbol, side, type, quantity };
        if (price && type === 'LIMIT') params.price = price;
        if (type === 'LIMIT') params.timeInForce = 'GTC';
        if (stopPrice && (type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET')) params.stopPrice = stopPrice;

        const data = await makeBinanceRequest('/fapi/v1/order', 'POST', apiKey, apiSecret, params);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error });
    }
});

// 5. Cancel Order
app.post('/api/cancel', async (req, res) => {
    const { apiKey, apiSecret, symbol, orderId } = req.body;
    try {
        const data = await makeBinanceRequest('/fapi/v1/order', 'DELETE', apiKey, apiSecret, { symbol, orderId });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
