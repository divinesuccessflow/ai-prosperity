#!/usr/bin/env python3
"""Upload a finished video to YouTube using a channel token.

    python3 publish_youtube.py --token /opt/divinecut/tokens/<channel>.json \
        --video out/clip1.mp4 [--thumbnail t.png] --title "..." [--desc ...] \
        [--tags a,b,c] [--privacy public|unlisted|private] [--category 22]

Channel tokens are created on the Mac (channel_auth.py pattern) and scp'd to
/opt/divinecut/tokens/. Prints the video URL. Marks AI-content disclosure.
"""
import argparse
import sys

SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube"]


def service(token_path):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds.valid and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        open(token_path, "w").write(creds.to_json())
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--thumbnail")
    ap.add_argument("--title", required=True)
    ap.add_argument("--desc", default="")
    ap.add_argument("--tags", default="")
    ap.add_argument("--privacy", default="unlisted")
    ap.add_argument("--category", default="22")
    a = ap.parse_args()

    from googleapiclient.http import MediaFileUpload
    yt = service(a.token)
    body = {"snippet": {"title": a.title[:100], "description": a.desc[:4900],
                        "tags": [t.strip() for t in a.tags.split(",") if t.strip()][:30],
                        "categoryId": a.category},
            "status": {"privacyStatus": a.privacy,
                       "selfDeclaredMadeForKids": False,
                       "containsSyntheticMedia": True}}
    media = MediaFileUpload(a.video, chunksize=-1, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    vid = resp["id"]
    if a.thumbnail:
        try:
            yt.thumbnails().set(videoId=vid,
                                media_body=MediaFileUpload(a.thumbnail)).execute()
        except Exception as e:
            print(f"thumbnail failed: {e}", file=sys.stderr)
    print(f"https://youtu.be/{vid}")


if __name__ == "__main__":
    main()
