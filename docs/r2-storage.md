# Cloudflare R2 이미지 저장소

웹과 텔레그램에서 업로드한 새 이미지를 private R2 버킷에 저장할 수 있습니다.
브라우저는 기존 API를 사용하고 서버가 R2에 접근합니다. CORS 설정은 필요하지 않습니다.
사진 조회에는 로그인과 단기 서명이 모두 필요합니다.

## 설정

1. Cloudflare에서 R2 버킷을 만들고 공개 접근(r2.dev·공개 사용자 도메인)을 끕니다.
2. 해당 버킷에 한정된 Object Read & Write API 토큰을 발급합니다.
3. 루트 `.env`에 다음 값을 설정합니다. 비밀 키는 Git이나 대화에 올리지 않습니다.

```dotenv
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<Cloudflare 계정 ID>
R2_BUCKET=<버킷 이름>
R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
```

4. `pnpm deploy:web`으로 설정을 반영합니다. 시작 로그에 설정 오류가 없는지 확인합니다.
5. 사진 한 장을 업로드하고 조회·삭제를 확인합니다. 버킷에서도 저장·삭제 여부를 확인합니다.

이 설정은 기본 jurisdiction의 R2 S3 endpoint를 사용합니다.
공식 안내: [R2 S3 설정](https://developers.cloudflare.com/r2/get-started/s3/),
[JavaScript SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

## 기존 사진과 정리

새 R2 키는 `profile/<id>/r2/<random>.<ext>` 또는 `import/<id>/r2/<random>.<ext>`입니다.
기존 로컬 키는 변경하지 않으므로 기존 사진과 합성 시드도 계속 읽을 수 있습니다.
기존 사진의 일괄 이동은 수행하지 않습니다. 로컬 저장 디렉터리를 보존하세요.
`STORAGE_PROVIDER=local`로 되돌려도 이미 저장한 R2 사진을 읽으려면 R2 자격 증명이 필요합니다.

만료 Import 정리도 키에 맞춰 로컬 또는 R2 객체를 삭제하며, 게시된 프로필이 참조하는
사진은 보존합니다. R2 오류가 나면 참조 행을 삭제하지 않고 실패를 반환합니다.
DB·로컬 파일 백업에는 R2 객체가 포함되지 않습니다.
