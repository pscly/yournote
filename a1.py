import json
import requests


def get_all_note(auth=''):
    # 仅用于测试调试
    if not auth:
        auth = "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJPaFNoZW5naHVvIiwiZXhwIjoxODI5ODA4NzY0LjYzODIwMiwidXNhZ2UiOiJsb2dpbiIsInVzZXJfaWQiOjQ2MDEwMH0.QPo7_h30nVre6sZ4KyziDC5mzjc446invEsE-hHCgbc"
    url = "https://nideriji.cn/api/v2/sync/"

    headers = {
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    'accept-language': "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    'auth': auth,
    'origin': "https://nideriji.cn",
    'priority': "u=1, i",
    'referer': "https://nideriji.cn/w/",
    'sec-ch-ua': "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
    'sec-ch-ua-mobile': "?0",
    'sec-ch-ua-platform': "\"Windows\"",
    'sec-fetch-dest': "empty",
    'sec-fetch-mode': "cors",
    'sec-fetch-site': "same-origin"
    }

    response = requests.post(url, headers=headers)

    rdata = response.json()
    with open('save_data.json', 'w', encoding='utf-8') as f:
        json.dump(rdata, f, ensure_ascii=False, indent=4)

    # rdata 解释
    # 可见 rdata解释.md

    return rdata


if __name__ == '__main__':
    a = get_all_note()
    print(a)

