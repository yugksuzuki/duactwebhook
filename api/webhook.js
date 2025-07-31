import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

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

function carregarRepresentantes() {
  const filePath = path.resolve("./public", "cepsr.csv");
  const csvContent = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(csvContent, { header: true });

  return parsed.data
    .filter(row => row.Latitude && row.Longitude)
    .map(row => ({
      nome: row.REPRESENTANTE,
      cidade: row.CIDADE,
      estado: row.ESTADO,
      celular: row["CELULAR"] || row["CELULAR 2"] || "",
      lat: parseFloat(row.Latitude),
      lon: parseFloat(row.Longitude),
    }));
}

async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "24d5173c43b74f549f4c6f5b263d52b3";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

async function tentarVariacoesDeCep(cepBase) {
  const prefixo = cepBase.slice(0, 5);
  const tentativas = [cepBase];

  for (let i = 1; i <= 99; i++) {
    const sufixoAlternativo = i.toString().padStart(3, "0");
    tentativas.push(`${prefixo}${sufixoAlternativo}`);
  }

  for (const cep of tentativas) {
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
      if (!data.erro) {
        console.log(`[DEBUG] CEP usado com sucesso: ${cep}`);
        return { cep, dados: data };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ reply: "❌ Método não permitido. Use POST." });
  }

  const { variables } = req.body;
  const cepOriginal = variables?.CEP_usuario?.replace(/\D/g, "");

  if (!cepOriginal || cepOriginal.length !== 8) {
    return res.status(200).json({ reply: "❌ CEP inválido ou incompleto. Tente novamente." });
  }

  let endereco = null;
  let dados = null;

  try {
    const tentativa = await tentarVariacoesDeCep(cepOriginal);
    if (!tentativa) throw new Error("CEP inválido");

    dados = tentativa.dados;
    const cidade = (dados.localidade || "").trim();
    const estado = dados.uf;
    const logradouro = dados.logradouro?.trim();

    endereco = logradouro
      ? `${logradouro}, ${cidade} - ${estado}, Brasil`
      : `${cidade} - ${estado}, Brasil`;
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  let coordenadas = null;
  try {
    coordenadas = await geocodificarEndereco(endereco);

    const cidade = (dados.localidade || "").trim();
    const estado = dados.uf;

    if (!coordenadas && cidade && estado) {
      console.log(`[DEBUG] Geocodificação fallback com cidade: ${cidade}, estado: ${estado}`);
      coordenadas = await geocodificarEndereco(`${cidade} - ${estado}, Brasil`);
    }

    if (!coordenadas) throw new Error("Sem resultado do OpenCage");
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;
  const estado = dados.uf;
  const cidadeUsuario = (dados.localidade || "").trim().toLowerCase();

  // Lógica base: busca o representante mais próximo no mesmo estado
  const lista = carregarRepresentantes().filter(rep => rep.estado === estado);
  let maisProximo = null;
  let menorDistancia = Infinity;

  for (const rep of lista) {
    const dist = haversine(latCliente, lonCliente, rep.lat, rep.lon);
    if (dist < menorDistancia) {
      menorDistancia = dist;
      maisProximo = { ...rep, distancia: dist };
    }
  }

  if (maisProximo && menorDistancia <= 200) {
    console.log(`[DEBUG] CEP: ${cepOriginal} | CIDADE: ${cidadeUsuario} | ESTADO: ${estado} | DIST: ${maisProximo.distancia.toFixed(1)} km`);
    return res.status(200).json({
      reply: `✅ Representante mais próximo do CEP ${cepOriginal}:\n\n📍 *${maisProximo.nome}* – ${maisProximo.cidade}/${maisProximo.estado}\n📞 WhatsApp: https://wa.me/55${maisProximo.celular}\n📏 Distância: ${maisProximo.distancia.toFixed(1)} km`,
    });
  }

  return res.status(200).json({
    reply: `❗ Nenhum representante encontrado em até 200 km no seu estado.\n\nPara assuntos gerais, por favor entre em contato com nosso atendimento:\n☎️ *Everson*\n+55 (48) 9211-0383`,
  });
}
