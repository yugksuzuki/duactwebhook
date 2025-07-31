export default function handler(req, res) {
  return res.send({
    reply: "✅ Estou funcionando! A conexão entre o Umbler e o Vercel está OK."
  });
}
