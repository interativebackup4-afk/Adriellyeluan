const https = require("https");

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbybTHfTO73h4gLzWzdaFci1EHWGATq4yhqcbCpE6Ih-y6ofwdosv9NsRdo51NJbjuESOw/exec";
const MP_ACCESS_TOKEN = "SUA_CHAVE_DE_PRODUCAO"; // ← substitui aqui

function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsRequest(res.headers.location, options, body).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsGet(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));
    console.log("Fetching URL:", url);
    https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    }, (res) => {
      console.log("Status:", res.statusCode, "Location:", res.headers.location);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        console.log("Response body:", data.substring(0, 200));
        resolve(data);
      });
    }).on("error", (err) => {
      console.log("Request error:", err.message);
      reject(err);
    });
  });
}

exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  // GET: criação de preferência de pagamento
  if (event.httpMethod === "GET") {
    const { id } = event.queryStringParameters || {};

    // Resposta ao teste do IPN do MP (sem id = é o teste)
    if (!id) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok" }) };
    }

    console.log("Received id:", id);
    try {
      const url = `${APPS_SCRIPT_URL}?acao=criarPagamento&id=${encodeURIComponent(id)}`;
      const text = await httpsGet(url);
      const data = JSON.parse(text);
      console.log("Parsed data:", JSON.stringify(data));
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
      console.log("Handler error:", err.message);
      return { statusCode: 500, headers, body: JSON.stringify({ erro: err.message }) };
    }
  }

  // POST: notificação IPN do Mercado Pago
  if (event.httpMethod === "POST") {
    try {
      const params = event.queryStringParameters || {};
      const topic = params.topic || params.type;
      const paymentId = params.id || params["data.id"];

      console.log("IPN recebido:", topic, paymentId);

      if (topic === "payment" && paymentId) {
        // Busca detalhes do pagamento na API do MP
        const mpUrl = new URL(`https://api.mercadopago.com/v1/payments/${paymentId}`);
        const mpRes = await httpsRequest(mpUrl.toString(), {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

        console.log("MP payment status:", mpRes.status);
        const payment = JSON.parse(mpRes.body);

        if (payment.status === "approved") {
          const presenteId = payment.external_reference;
          console.log("Pagamento aprovado para presente:", presenteId);

          // Notifica o Apps Script para marcar como VENDIDO
          const scriptUrl = `${APPS_SCRIPT_URL}?acao=marcarVendido&id=${encodeURIComponent(presenteId)}`;
          await httpsGet(scriptUrl);
          console.log("Presente marcado como VENDIDO:", presenteId);
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok" }) };
    } catch (err) {
      console.log("IPN error:", err.message);
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ok" }) };
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ status: "ok" }) };
};
