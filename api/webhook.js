import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

function normalize(str) {
  return str?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Haversine (distância entre dois pontos em km)
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

// Carrega representantes do CSV
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

// Obtem lat/lng via OpenCage com string completa (endereço)
async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "6f023fbf4eb34fedb8a992699fe98330";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

// Tentativas inteligentes de variações de CEP (FASE 1 e 2)
async function tentarVariacoesDeCep(cepBase) {
  const prefixoBase = cepBase.slice(0, 5);
  const tentativas = [];

  for (let i = 1; i <= 20; i++) {
    const sufixo = i.toString().padStart(3, "0");
    tentativas.push({ cep: `${prefixoBase}${sufixo}`, fase: "FASE 1" });
  }

  const penultimos = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const n of penultimos) {
    const novoPrefixo = `${prefixoBase.slice(0, 3)}${n}0`;
    tentativas.push({ cep: `${novoPrefixo}000`, fase: "FASE 2" });
  }

  console.time("🧠 Tempo total para busca de CEP válido");

  for (const tentativa of tentativas) {
    const { cep, fase } = tentativa;
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
      if (!data.erro) {
        console.log(`[✅ ${fase}] CEP encontrado: ${cep}`);
        console.timeEnd("🧠 Tempo total para busca de CEP válido");
        return { cep, dados: data };
      } else {
        console.log(`[❌ ${fase}] CEP ${cep} inválido.`);
      }
    } catch (err) {
      console.warn(`[ERRO ${fase}] Falha ao consultar CEP ${cep}: ${err.message}`);
    }
  }

  console.timeEnd("🧠 Tempo total para busca de CEP válido");
  return null;
}

// Webhook principal
export default async function handler(req, res) {
  console.log("🚀 Iniciando webhook");

  if (req.method !== "POST") {
    return res.status(200).json({ reply: "❌ Método não permitido. Use POST." });
  }

  const { variables } = req.body;
  const cep = variables?.CEP_usuario?.replace(/\D/g, "");

  console.log("🔍 CEP recebido:", cep);

  if (!cep || cep.length !== 8) {
    return res.status(200).json({ reply: "❌ CEP inválido ou incompleto. Tente novamente." });
  }

  let dados = null;
  let endereco = null;

  try {
    const tentativa = await tentarVariacoesDeCep(cep);
    if (!tentativa) throw new Error("Nenhum CEP válido encontrado");
    dados = tentativa.dados;
    endereco = `${dados.logradouro || ""}, ${dados.localidade} - ${dados.uf}, Brasil`;
    console.log("📍 Localidade encontrada:", dados.localidade, "| Estado:", dados.uf);
  } catch (err) {
    console.error("❌ Erro ao encontrar CEP:", err.message);
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  let coordenadas = null;
  try {
    coordenadas = await geocodificarEndereco(endereco);
    if (!coordenadas) throw new Error("Sem resultado do OpenCage");
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;

  // 🟨 Exceções SP
  if (dados.uf === "SP") {
    const distAgnaldo = haversine(latCliente, lonCliente, -21.944455, -51.6483067);
    if (distAgnaldo <= 100) {
      return res.status(200).json({
        reply: `✅ Representante mais próximo do CEP ${cep}:\n\n📍 *Agnaldo* – Santo Anastácio/SP\n📞 WhatsApp: https://wa.me/5518996653510\n📏 Distância: ${distAgnaldo.toFixed(1)} km`,
      });
    }

    const cidadesMarcelo = [
      "Santos", "São Vicente", "Praia Grande", "Guarujá", "Bertioga",
      "Itanhaém", "Mongaguá", "Peruíbe", "Ubatuba", "Caraguatatuba",
      "São Sebastião", "Ilhabela", "Cubatão", "Barretos"
    ];
    if (cidadesMarcelo.includes(dados.localidade)) {
      return res.status(200).json({
        reply: `✅ Representante para o Litoral Paulista e Barretos:\n\n📍 *Marcelo*\n📞 WhatsApp: https://wa.me/5511980323728`,
      });
    }
  }

// 🎯 Regra para Região Metropolitana de Porto Alegre e arredores (Adriano)
if (dados.uf === "RS") {
  const cidadesAdriano = [
    "porto alegre", "canoas", "viamão", "cachoeirinha", "sapucaia do sul",
    "esteio", "alvorada", "gravataí", "nova santa rita", "guaíba"
  ];

  if (cidadesAdriano.includes(dados.localidade.toLowerCase())) {
    return res.status(200).json({
      reply: `✅ Representante para Região Metropolitana de Porto Alegre:\n\n📍 *Adriano*\n📞 WhatsApp: https://wa.me/5551991089339`,
    });
  }

  // Fallback por raio de 100 km de Porto Alegre
  const adrianoLat = -30.0277;
  const adrianoLon = -51.2287;
  const distAdriano = haversine(latCliente, lonCliente, adrianoLat, adrianoLon);
  if (distAdriano <= 100) {
    return res.status(200).json({
      reply: `✅ Representante para região próxima a Porto Alegre (RS):\n\n📍 *Adriano*\n📞 WhatsApp: https://wa.me/5551991089339\n📏 Distância: ${distAdriano.toFixed(1)} km`,
    });
  }
}

// 🟦 Regras para SC
if (dados.uf === "SC") {
  const cidade = normalize(dados.localidade);

  // Bruno → Itajaí e Navegantes
  if (["itajai", "navegantes"].includes(cidade)) {
    return res.status(200).json({
      reply: `✅ Representante para Itajaí, Navegantes e região:\n\n📍 *Bruno*\n📞 WhatsApp: https://wa.me/5547999582138`,
    });
  }

  // Cristian (Andre) → Oeste Catarinense
  if (
    [
      "chapeco", "dionisio cerqueira", "joacaba", "palmitos",
      "pinhalzinho", "sao miguel do oeste", "seara", "xanxere", "xaxim"
    ].includes(cidade)
  ) {
    return res.status(200).json({
      reply: `✅ Representante para o Oeste Catarinense:\n\n📍 *Cristian (Andre)*\n📞 WhatsApp: https://wa.me/555984480883`,
    });
  }

  // Diego → Tubarão
  if (cidade === "tubarao") {
    return res.status(200).json({
      reply: `✅ Representante para Tubarão e região:\n\n📍 *Diego*\n📞 WhatsApp: https://wa.me/5548996823353`,
    });
  }

  // Peter → Litoral Sul de SC
  if (
    [
      "ararangua", "balneario gaivota", "balneario rincao", "cocal do sul",
      "criciuma", "forquilhinha", "jacinto machado", "meleiro", "passo de torres",
      "praia grande", "santa rosa do sul", "sombrio", "timbe do sul", "turvo"
    ].includes(cidade)
  ) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Sul de SC:\n\n📍 *Peter*\n📞 WhatsApp: https://wa.me/554896894570`,
    });
  }

  // Duact → Porto Belo
  if (cidade === "porto belo") {
    return res.status(200).json({
      reply: `✅ Representante oficial DUACT para Porto Belo:\n\n📍 *Duact*\n📞 WhatsApp: https://wa.me/555189204839`,
    });
  }
}



  // 🔎 Busca padrão por estado
  const repsTodos = carregarRepresentantes();

  console.log("📦 Estados carregados do CSV:", [...new Set(repsTodos.map(r => `"${r.estado}"`))]);
  console.log("📍 Estado retornado pelo CEP:", `"${dados.uf}"`);

  const lista = repsTodos.filter(rep =>
    rep.estado?.toString().trim().toUpperCase() === dados.uf?.toString().trim().toUpperCase()
  );

  console.log("📍 Coordenadas cliente:", latCliente, lonCliente);
  console.log("📍 Total de representantes no estado:", lista.length);

  let maisProximo = null;
  let menorDistancia = Infinity;

  for (const rep of lista) {
    const dist = haversine(latCliente, lonCliente, rep.lat, rep.lon);
    console.log(`🔎 ${rep.nome} em ${rep.cidade} → ${dist.toFixed(2)} km`);

    if (dist < menorDistancia) {
      menorDistancia = dist;
      maisProximo = { ...rep, distancia: dist };
    }
  }

  if (maisProximo && menorDistancia <= 200) {
    return res.status(200).json({
      reply: `✅ Representante mais próximo do CEP ${cep}:\n\n📍 *${maisProximo.nome}* – ${maisProximo.cidade}/${maisProximo.estado}\n📞 WhatsApp: https://wa.me/55${maisProximo.celular}\n📏 Distância: ${maisProximo.distancia.toFixed(1)} km`,
    });
  }

  return res.status(200).json({
    reply: `❗ Nenhum representante encontrado em até 200 km no seu estado.\n\nPara assuntos gerais, por favor entre em contato com nosso atendimento:\n☎️ *Everson*\n+55 (48) 9211-0383`,
  });
}
