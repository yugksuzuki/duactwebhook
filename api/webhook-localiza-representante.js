import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

// Cálculo de distância (Haversine)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Lê representantes do CSV
function carregarRepresentantes() {
  const filePath = path.resolve("./public", "ceps.csv");
  const csvContent = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(csvContent, { header: true });

  return parsed.data
    .filter(row => row.Latitude && row.Longitude)
    .map(row => ({
      nome: row.REPRESENTANTE,
      cidade: row.CIDADE,
      estado: row.ESTADO,
      celular: row.CELULAR,
      lat: parseFloat(row.Latitude),
      lon: parseFloat(row.Longitude),
    }));
}

// Geocodifica via OpenCage
async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "24d5173c43b74f549f4c6f5b263d52b3";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

// Tenta CEPs alternativos (001...010)
async function tentarVariacoesDeCep(cepBase) {
  const prefixo = cepBase.slice(0, 5);
  const tentativas = [cepBase];
  for (let i = 1; i <= 10; i++) {
    tentativas.push(`${prefixo}${i.toString().padStart(3, "0")}`);
  }

  for (const cep of tentativas) {
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
      if (!data.erro) return { cep, dados: data };
    } catch {}
  }

  return null;
}

// Handler principal
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.send({ reply: "Método inválido. Use POST." });
  }

  const { variables } = req.body;
  const cepOriginal = variables?.CEP_usuario?.replace(/\D/g, "");

  if (!cepOriginal || cepOriginal.length !== 8) {
    return res.send({ reply: "CEP inválido. Envie um CEP completo com 8 dígitos." });
  }

  let dados = null;
  let endereco = null;

  try {
    const tentativa = await tentarVariacoesDeCep(cepOriginal);
    if (!tentativa) throw new Error("CEP inválido");
    dados = tentativa.dados;
    endereco = `${dados.logradouro || ""}, ${dados.localidade} - ${dados.uf}`;
  } catch {
    return res.send({ reply: "Erro ao consultar o CEP. Verifique se está correto." });
  }

  let coordenadas;
  try {
    coordenadas = await geocodificarEndereco(endereco);
    if (!coordenadas) throw new Error("Sem coordenadas");
  } catch {
    return res.send({ reply: "Erro ao localizar sua região. Tente novamente." });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;

  // Regra SP - Agnaldo
  if (dados.uf === "SP") {
    const distAgnaldo = haversine(latCliente, lonCliente, -21.944455, -51.6483067);
    if (distAgnaldo <= 100) {
      return res.send({
        reply: `Representante próximo:\n*Agnaldo* – Santo Anastácio/SP\nWhatsApp: wa.me/5518996653510`
      });
    }

    const cidadesMarcelo = [
      "santos", "são vicente", "praia grande", "guarujá", "bertioga",
      "itanhaém", "mongaguá", "peruíbe", "ubatuba", "caraguatatuba",
      "são sebastião", "ilhabela", "cubatão", "barretos"
    ];
    const cidadeUsuario = dados.localidade?.toLowerCase().trim();
    if (cidadesMarcelo.includes(cidadeUsuario)) {
      return res.send({
        reply: `Representante para o litoral:\n*Marcelo*\nWhatsApp: wa.me/5511980323728`
      });
    }
  }

  // Busca padrão
  const lista = carregarRepresentantes().filter(rep => rep.estado === dados.uf);

  let maisProximo = null;
  let menorDist = Infinity;

  for (const rep of lista) {
    const dist = haversine(latCliente, lonCliente, rep.lat, rep.lon);
    if (dist < menorDist) {
      menorDist = dist;
      maisProximo = { ...rep, distancia: dist };
    }
  }

  if (maisProximo && menorDist <= 200) {
    return res.send({
      reply: `Representante próximo:\n*${maisProximo.nome}* – ${maisProximo.cidade}/${maisProximo.estado}\nWhatsApp: wa.me/55${maisProximo.celular}`
    });
  }

  return res.send({
    reply: `Nenhum representante encontrado perto de você.\nFale com nosso suporte:\nwa.me/554892110383`
  });
}
