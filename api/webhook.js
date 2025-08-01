import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

// Haversine (distância entre dois pontos em km)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lat2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Carrega representantes do CSV
function carregarRepresentantes() {
  const filePath = path.resolve("./public", "ceps.csv"); // ou ceps_corrigido.csv
  const csvContent = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(csvContent, { header: true });

  return parsed.data
    .filter(row => row.Latitude && row.Longitude)
    .map(row => ({
      nome: row.REPRESENTANTE?.trim(),
      cidade: row.CIDADE?.trim(),
      estado: row.ESTADO?.toString().trim().toUpperCase(),
      celular: row.CELULAR?.replace(/\D/g, ""),
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

// Variações de CEP inteligentes com logs
async function tentarVariacoesDeCep(cepBase) {
  const prefixoBase = cepBase.slice(0, 5);
  const tentativas = [];

  console.time("[FASE 1] Tempo para sufixos 001 a 020");
  for (let i = 1; i <= 20; i++) {
    const sufixo = i.toString().padStart(3, "0");
    tentativas.push({ cep: `${prefixoBase}${sufixo}`, fase: "FASE 1" });
  }
  console.timeEnd("[FASE 1] Tempo para sufixos 001 a 020");

  console.time("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");
  const penultimos = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const n of penultimos) {
    const novoPrefixo = `${prefixoBase.slice(0, 3)}${n}0`;
    tentativas.push({ cep: `${novoPrefixo}000`, fase: "FASE 2" });
  }
  console.timeEnd("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");

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

export default async function handler(req, res) {
  console.log("🚀 handler foi chamado");

  if (req.method !== "POST") {
    console.log("⚠️ Método não é POST");
    return res.status(200).json({ reply: "❌ Método não permitido. Use POST." });
  }

  const { variables } = req.body;
  const cep = variables?.CEP_usuario?.replace(/\D/g, "");

  console.log("🧾 CEP recebido:", cep);

  if (!cep || cep.length !== 8) {
    console.log("❌ CEP inválido detectado");
    return res.status(200).json({ reply: "❌ CEP inválido ou incompleto. Tente novamente." });
  }

  let endereco = null;
  let dados = null;

  try {
    const tentativa = await tentarVariacoesDeCep(cep);
    if (!tentativa) throw new Error("CEP não encontrado");

    dados = tentativa.dados;
    endereco = `${dados.logradouro || ""}, ${dados.localidade} - ${dados.uf}, Brasil`;

    console.log("📍 Endereço montado:", endereco);
    console.log("📍 Estado retornado pelo CEP:", `"${dados.uf}"`);
  } catch (err) {
    console.log("❌ Erro ao buscar CEP:", err.message);
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  let coordenadas = null;
  try {
    coordenadas = await geocodificarEndereco(endereco);
    if (!coordenadas) throw new Error("Sem resultado do OpenCage");
  } catch (err) {
    console.log("❌ Erro ao geocodificar:", err.message);
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;

  // 🟨 EXCEÇÕES para SP
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

  // 🔎 Busca padrão com representantes do mesmo estado
  const repsTodos = carregarRepresentantes();

  // 🔍 Debug dos estados únicos carregados
  console.log("📦 Estados carregados do CSV:", [...new Set(repsTodos.map(r => `"${r.estado}"`))]);

  // Filtro robusto
  const lista = repsTodos.filter(rep =>
    rep.estado?.toString().trim().toUpperCase() === dados.uf?.toString().trim().toUpperCase()
  );

  let maisProximo = null;
  let menorDistancia = Infinity;

  console.log("📍 Coordenadas cliente:", latCliente, lonCliente);
  console.log("📍 Representantes encontrados no estado:", lista.length);

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
