const STORE_HASH = process.env.BC_STORE_HASH;
const ACCESS_TOKEN = process.env.BC_ACCESS_TOKEN;

const TRANSFER_METHOD_ID = 'bankdeposit';
const TRANSFER_DISCOUNT_PERCENT = 5;

async function bcFetch(path, options = {}) {
    const response = await fetch(
        `https://api.bigcommerce.com/stores/${STORE_HASH}${path}`,
        {
            ...options,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Auth-Token': ACCESS_TOKEN,
                ...(options.headers || {}),
            },
        },
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    return data;
}

module.exports = async function handler(req, res) {
    const allowedOrigins = [
        'https://toolmex.mybigcommerce.com',
    ];

    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Vary', 'Origin');

    res.setHeader(
        'Access-Control-Allow-Methods',
        'POST, OPTIONS'
    );

    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-CSRF-Token'
    );

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed',
        });
    }

    try {
        const { checkoutId, paymentMethodId } = req.body || {};

        if (!checkoutId || !paymentMethodId) {
            return res.status(400).json({
                success: false,
                error: 'checkoutId y paymentMethodId son requeridos',
            });
        }

        // 1. Obtener checkout actual
        let response = await bcFetch(
            `/v3/checkouts/${encodeURIComponent(checkoutId)}`,
        );

        let checkout = response.data;

        // 2. Quitar descuento manual actual
        //    para evitar calcular 5% sobre un total ya descontado
        response = await bcFetch(
            `/v3/checkouts/${encodeURIComponent(checkoutId)}/discounts`,
            {
                method: 'POST',
                body: JSON.stringify({
                    cart: {
                        discounts: [],
                    },
                }),
            },
        );

        checkout = response.data;

        // 3. Si NO es transferencia, dejamos el checkout normal
        if (paymentMethodId !== TRANSFER_METHOD_ID) {
            return res.status(200).json({
                success: true,
                transfer: false,
                discountAmount: 0,
                grandTotal: checkout.grand_total,
            });
        }

        // 4. Usamos grand_total completo:
        // productos + envío + impuestos, etc.
        const grandTotal = Number(checkout.grand_total);

        const discountAmount = Number(
            (grandTotal * (TRANSFER_DISCOUNT_PERCENT / 100)).toFixed(2),
        );

        // 5. Aplicar 5%
        response = await bcFetch(
            `/v3/checkouts/${encodeURIComponent(checkoutId)}/discounts`,
            {
                method: 'POST',
                body: JSON.stringify({
                    cart: {
                        discounts: [
                            {
                                discounted_amount: discountAmount,
                            },
                        ],
                    },
                }),
            },
        );

        checkout = response.data;

        return res.status(200).json({
            success: true,
            transfer: true,
            discountAmount,
            grandTotal: checkout.grand_total,
        });

    } catch (error) {
        console.error('TEISA transfer discount:', error);

        return res.status(500).json({
            success: false,
            error: 'No se pudo actualizar el descuento',
        });
    }
};