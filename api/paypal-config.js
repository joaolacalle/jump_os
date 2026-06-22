// api/paypal-config.js — fornece configuração pública do PayPal ao frontend
// (Client ID e Plan IDs são públicos por design — o Secret NUNCA sai daqui)
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    plans: {
      basico: process.env.PAYPAL_PLAN_BASICO || '',
      plus: process.env.PAYPAL_PLAN_PLUS || '',
      pro: process.env.PAYPAL_PLAN_PRO || '',
    },
  });
};
