import json
import os
import requests

auth = (os.environ.get("NIDERIJI_AUTH") or "").strip()
if not auth:
    raise RuntimeError("缺少认证信息：请设置环境变量 NIDERIJI_AUTH（例如：token eyJhbGci...）")

url = "https://nideriji.cn/api/diary/all_by_ids/1022956/"       # 这个似乎是别人 的id

payload = {
  'diary_ids': '35302264'   #  # 这个是日记的id
}

headers = {
  'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
  'Accept-Encoding': "gzip, deflate, br, zstd",
  'sec-ch-ua-platform': "\"Windows\"",
  'sec-ch-ua': "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
  'auth': auth,
  'sec-ch-ua-mobile': "?0",
  'origin': "https://nideriji.cn",
  'sec-fetch-site': "same-origin",
  'sec-fetch-mode': "cors",
  'sec-fetch-dest': "empty",
  'referer': "https://nideriji.cn/w/",
  'accept-language': "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  'priority': "u=1, i"
}

response = requests.post(url, data=payload, headers=headers)

rdata1 = response.json()
with open('save_data2.json', 'w', encoding='utf-8') as f:
    json.dump(rdata1, f, ensure_ascii=False, indent=4)
