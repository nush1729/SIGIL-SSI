import axios from "axios"

export async function uploadToIPFS(data: any) {
  const res = await axios.post("/api/ipfs/json", data)
  return res.data.cid
}

export async function uploadFileToIPFS(file: File) {
  const formData = new FormData()
  formData.append("file", file)

  const res = await axios.post("/api/ipfs/file", formData, {
    maxBodyLength: Infinity,
    headers: {
      "Content-Type": "multipart/form-data",
    },
  })

  return res.data.cid
}
