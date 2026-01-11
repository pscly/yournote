import json
import os
import requests


def get_all_note(auth=''):
    # 仅用于测试调试
    if not auth:
        # 不要把 Token 硬编码进仓库，避免泄露；需要时用环境变量注入
        # 示例（PowerShell 7）：
        #   $env:NIDERIJI_AUTH="token eyJhbGci..."; python a1.py
        auth = (os.environ.get("NIDERIJI_AUTH") or "").strip()
        if not auth:
            raise RuntimeError("缺少认证信息：请传入 auth 参数，或设置环境变量 NIDERIJI_AUTH")
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

