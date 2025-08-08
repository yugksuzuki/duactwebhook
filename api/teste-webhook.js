import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

function normalize(str) {
  return str?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}


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
  const filePath = path.resolve("./data", "representantes.json");
  const jsonContent = fs.readFileSync(filePath, "utf8");
  const dados = JSON.parse(jsonContent);

  const representantes = dados
    .map((item) => ({
      nome: item.REPRESENTANTE,
      cidade: normalize(item.NM_MUNICIP),
      estado: item.UF,
      celular: item.CELULAR?.replace(/\D/g, ""),
      lat: parseFloat(item.Latitude),
      lon: parseFloat(item.Longitude),
    }))
    .filter(
      (r) =>
        r.nome &&
        r.estado &&
        r.cidade &&
        !isNaN(r.lat) &&
        !isNaN(r.lon) &&
        r.celular
    );

  return representantes;
}


async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "24d5173c43b74f549f4c6f5b263d52b3";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

async function tentarVariacoesDeCep(cepBase) {
  const prefixoBase = cepBase.slice(0, 5);
  const tentativas = [];

  console.time("[FASE 1] Tempo para sufixos 001 a 020");

  // 🔁 Fase 1: apenas 20 sufixos de 001 a 020
  for (let i = 1; i <= 20; i++) {
    const sufixo = i.toString().padStart(3, "0"); 
    tentativas.push({ cep: `${prefixoBase}${sufixo}`, fase: "FASE 1" });
  }

  console.timeEnd("[FASE 1] Tempo para sufixos 001 a 020");

  console.time("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");

  // 🔁 Fase 2: variação no penúltimo dígito (94910-000, 94920-000, ..., 94990-000)
  const penultimos = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const n of penultimos) {
    const novoPrefixo = `${prefixoBase.slice(0, 3)}${n}0`;
    tentativas.push({ cep: `${novoPrefixo}000`, fase: "FASE 2" });
  }

  console.timeEnd("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");

  console.time("🧠 Tempo total para busca de CEP válido");

  // 🔎 Tenta os CEPs gerados, um por um
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
      continue;
    }
  }

  console.timeEnd("🧠 Tempo total para busca de CEP válido");
  return null; // Nenhum CEP válido encontrado
}


export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ reply: "❌ Método não permitido. Use POST." });
  }

  const { variables } = req.body;
  const cepOriginal = variables?.CEP_usuario?.replace(/\D/g, "");

// 🔒 Força retorno fixo para Adriano em 94480560
if (cepOriginal === "94480560") {
  return res.status(200).json({
    reply: `✅ Representante responsável por sua região:\n\n📍 *Reginaldo*\n📞 WhatsApp: https://wa.me/5551991089339`,
  });
}



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
 const cidadeUsuario = normalize(dados.localidade || "");


  // 📌 Regras personalizadas:
// 🎯 Regras específicas para o estado do RS

  if (["RJ", "ES"].includes(estado)) {
    return res.status(200).json({
      reply: `✅ Representante para todo o estado do ${estado}:\n\n📍 *Rafa*\n📞 WhatsApp: https://wa.me/5522992417676`,
    });
  }

  if (estado === "MG") {
    return res.status(200).json({
      reply: `✅ Representante para Minas Gerais:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/553497646714`,
    });
  }
// MT e MS – Representante Gabriel
if (["MT", "MS"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para o estado do ${estado}:\n\n📍 *Gabriel*\n📞 WhatsApp: https://wa.me/554999230141`
  });
}

 
// 🌎 Regras para o Nordeste

// Piauí (apenas Teresina)
if (estado === "PI" && cidadeUsuario === "teresina") {
  return res.status(200).json({
    reply: `✅ Representante para Teresina (PI):\n\n📍 *Nonato*\n📞 WhatsApp: https://wa.me/5586998492624`,
  });
}

// Ceará e Rio Grande do Norte (inteiros)
if (["CE", "RN"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para ${estado === "CE" ? "Ceará" : "Rio Grande do Norte"}:\n\n📍 *Júnior*\n📞 WhatsApp: https://wa.me/5585999965434`,
  });
}

// Paraíba (somente Campina Grande)
if (estado === "PB" && cidadeUsuario === "campina grande") {
  return res.status(200).json({
    reply: `✅ Representante para Campina Grande (PB):\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
  });
}

// Pernambuco / Alagoas (apenas Maceió) / Sergipe / Bahia inteira
if (
  estado === "PE" ||
  estado === "SE" ||
  estado === "BA" ||
  (estado === "AL" && cidadeUsuario === "maceió")
) {
  return res.status(200).json({
    reply: `✅ Representante para ${estado === "PE" ? "Pernambuco" : estado === "SE" ? "Sergipe" : estado === "BA" ? "Bahia" : "Maceió (AL)"}:\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
  });
}


  // 🔄 Fallback com cálculo de distância por Haversine
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
 reply: `✅ Representante responsável por sua região:\n\n📍 *${maisProximo.nome}*\n📞 WhatsApp: https://wa.me/55${maisProximo.celular}`,
});

  }

  return res.status(200).json({
    reply: `❗ Nenhum representante encontrado em até 200 km no seu estado.\n\nPara assuntos gerais, por favor entre em contato com nosso atendimento:\n☎️ *Everson*\n WhatsApp: https://wa.me/554892110383`,
  });
}
