const https = require("https");

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzXDsbPBsQKIgTWGTOr4KbIA2U28AwdIF7TKkPye0zySCRFFu6T7SrpG_guV4mOEtQ9SA/exec";
const MP_ACCESS_TOKEN = "SUA_CHAVE_DE_PRODUCAO"; // ← substitui aqui

function httpsGet(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));
    https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  // GET - criar preferência de pagamento
  if (req.method === "GET") {
    const { id } = req.query;

    if (!id) {
      return res.status(200).json({ status: "ok" });
    }

    try {
      const url = `${APPS_SCRIPT_URL}?acao=criarPagamento&id=${encodeURIComponent(id)}`;
      const text = await httpsGet(url);
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // POST - webhook do MP
  if (req.method === "POST") {
    try {
      const { topic, id, type } = req.query;
      const paymentTopic = topic || type;
      const paymentId = id || (req.body && req.body.data && req.body.data.id);

      if (paymentTopic === "payment" && paymentId) {
        const mpRes = await httpsRequest(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          {
            method: "GET",
            headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
          }
        );

        const payment = JSON.parse(mpRes.body);

        if (payment.status === "approved") {
          const presenteId = payment.external_reference;
          await httpsGet(`${APPS_SCRIPT_URL}?acao=marcarVendido&id=${encodeURIComponent(presenteId)}`);
        }
      }

      return res.status(200).json({ status: "ok" });
    } catch (err) {
      return res.status(200).json({ status: "ok" });
    }
  }

  return res.status(200).json({ status: "ok" });
};
