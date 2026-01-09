
import requests

url = "https://nideriji.cn/api/diary/all_by_ids/1022956/"       # 这个似乎是别人 的id

payload = {
  'diary_ids': '35302264'   #  # 这个是日记的id
}

headers = {
  'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
  'Accept-Encoding': "gzip, deflate, br, zstd",
  'sec-ch-ua-platform': "\"Windows\"",
  'sec-ch-ua': "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
  'auth': "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJPaFNoZW5naHVvIiwiZXhwIjoxODI5ODA4NzY0LjYzODIwMiwidXNhZ2UiOiJsb2dpbiIsInVzZXJfaWQiOjQ2MDEwMH0.QPo7_h30nVre6sZ4KyziDC5mzjc446invEsE-hHCgbc",
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
import json
with open('save_data2.json', 'w', encoding='utf-8') as f:
    json.dump(rdata1, f, ensure_ascii=False, indent=4)
