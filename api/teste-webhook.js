import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

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
  let coordenadas = null;

  try {
    let tentativa = await tentarVariacoesDeCep(cepOriginal);

    if (!tentativa) {
      const geoFallback = await geocodificarEndereco(`${cepOriginal}, Brasil`);
      if (!geoFallback) {
        return res.status(200).json({
          reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
        });
      }

      dados = {
        localidade: "",
        uf: "",
        logradouro: "",
      };
      endereco = `${cepOriginal}, Brasil`;
      coordenadas = geoFallback;
    } else {
      dados = tentativa.dados;
      const cidade = (dados.localidade || "").trim();
      const estado = dados.uf;
      const logradouro = dados.logradouro?.trim();

      endereco = logradouro
        ? `${logradouro}, ${cidade} - ${estado}, Brasil`
        : `${cidade} - ${estado}, Brasil`;
    }
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  try {
    if (!coordenadas) {
      coordenadas = await geocodificarEndereco(endereco);
    }

    if (!dados.uf && coordenadas) {
      const reverse = await axios.get(
        `https://api.opencagedata.com/geocode/v1/json?q=${coordenadas.lat}+${coordenadas.lng}&key=24d5173c43b74f549f4c6f5b263d52b3&language=pt`
      );
      const componente = reverse.data?.results?.[0]?.components;
      if (componente) {
        dados.localidade = componente.city || componente.town || componente.village || "";
        dados.uf = componente.state_code || "";
      }
    }

    if (!coordenadas) {
      throw new Error("Sem resultado do OpenCage");
    }
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;
  const estado = dados.uf;
  const cidadeUsuario = (dados.localidade || "").trim().toLowerCase();

  // ⬇️ Coloque as regras aqui


  if (estado === "RS" && cidadeUsuario === "rio grande") {
    const dioneiLat = -32.035;
    const dioneiLon = -52.099;
    const dist = haversine(latCliente, lonCliente, dioneiLat, dioneiLon);
    if (dist <= 50) {
      return res.status(200).json({
        reply: `✅ Representante para Rio Grande (RS) e 50km ao redor:\n\n📍 *Dionei*\n📞 WhatsApp: https://wa.me/53532910789\n📏 Distância: ${dist.toFixed(1)} km`,
      });
    }
  }

  if (["RJ", "ES"].includes(estado)) {
    return res.status(200).json({
      reply: `✅ Representante para todo o estado do ${estado}:\n\n📍 *Rafa*\n📞 WhatsApp: https://wa.me/5522992417676`,
    });
  }

  if (estado === "MG") {
    return res.status(200).json({
      reply: `✅ Representante para Minas Gerais:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5516999774274`,
    });
  }

  if (estado === "PR") {
    const distLoanda = haversine(latCliente, lonCliente, -22.9297, -53.1366);
    const cidadesOeste = ["toledo", "cascavel", "foz do iguaçu", "medianeira", "marechal cândido rondon"];
    if (distLoanda <= 200 || cidadesOeste.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para raio de 200km a partir de Loanda (PR) e Oeste do PR:\n\n📍 *Mela*\n📞 WhatsApp: https://wa.me/5544991254963`,
      });
    }
    return res.status(200).json({
      reply: `✅ Representante para Curitiba e demais regiões do Paraná:\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
    });
  }

  if (estado === "RS" && ["torres", "tramandaí", "terra de areia", "arroio do sal", "são joão do sul", "morrinhos do sul"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Gaúcho:\n\n📍 *Daniel*\n📞 WhatsApp: https://wa.me/555199987333`,
    });
  }

  if (estado === "RS" && ["porto alegre", "guaíba", "sapucaia do sul", "cachoeirinha"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para Região Metropolitana de Porto Alegre e Serra Gaúcha:\n\n📍 *Adriano e Reginaldo*\n📞 WhatsApp: https://wa.me/5551991089339`,
    });
  }

  if (
    (estado === "RS" && ["santa rosa", "ijui", "cruz alta", "são luiz gonzaga", "santo ângelo", "passo fundo", "santa maria"].includes(cidadeUsuario)) ||
    (estado === "SC" && ["chapecó", "palmitos", "pinhalzinho", "são miguel do oeste"].includes(cidadeUsuario))
  ) {
    return res.status(200).json({
      reply: `✅ Representante para Oeste Gaúcho e Extremo Oeste Catarinense:\n\n📍 *Cristian*\n📞 WhatsApp: https://wa.me/555984491079`,
    });
  }

  if (estado === "SC" && ["blumenau", "brusque"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para Blumenau, Brusque e região:\n\n📍 *Alan*\n📞 WhatsApp: https://wa.me/554799638565`,
    });
  }

  if (estado === "SC" && ["imbituba", "garopaba", "laguna", "tubarão"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Sul de SC:\n\n📍 *Peterson*\n📞 WhatsApp: https://wa.me/554899658600`,
    });
  }

  if (estado === "SC" && ["balneário camboriú", "itajai", "navegantes", "penha", "itapema", "porto belo", "bombinhas"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Centro-Norte de SC:\n\n📍 *Diego*\n📞 WhatsApp: https://wa.me/554898445939`,
    });
  }

  if (estado === "SP") {
    const litoralSP = [
      "santos", "são vicente", "guarujá", "praia grande", "cubatão", "bertioga",
      "caraguatatuba", "ubatuba", "ilhabela", "mongaguá", "itanhaém", "peruíbe"
    ];

    const interiorSP = [
      "barretos", "franca", "ribeirão preto", "guaira", "batatais", "são joaquim da barra",
      "sertãozinho", "bebedouro", "orlândia", "altinópolis", "jardinópolis"
    ];

    const oesteSP = [
      "santo anastácio", "presidente prudente", "presidente epitácio", "dracena",
      "teodoro sampaio", "mirante do paranapanema"
    ];

    if (litoralSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Litoral Paulista:\n\n📍 *Marcelo*\n📞 WhatsApp: https://wa.me/5516997774274`
      });
    }

    if (interiorSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Interior de São Paulo:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/55179981233263`
      });
    }

    if (oesteSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Oeste Paulista:\n\n📍 *Aguinaldo*\n📞 WhatsApp: https://wa.me/5518996653510`
      });
    }

    return res.status(200).json({
      reply: `✅ Representante para São Paulo:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/55179981233263`
    });
  }

  //fim regras

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
