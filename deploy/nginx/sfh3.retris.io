map $http_upgrade $sfh3_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name sfh3.retris.io;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name sfh3.retris.io;

    ssl_certificate /etc/letsencrypt/live/sfh3.retris.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sfh3.retris.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/sfh3.retris.io;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css application/javascript application/json
               image/svg+xml application/wasm;

    location ^~ /assets/ {
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public";
    }

    location ^~ /ui/ {
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public";
    }

    location ^~ /fonts/ {
        try_files $uri =404;
        expires 30d;
        add_header Cache-Control "public";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location = /servers.json {
        add_header Cache-Control "no-store";
        try_files $uri =404;
    }

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $sfh3_connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;

    location = /ws/1   { proxy_pass http://127.0.0.1:7801/; }
    location ^~ /ws/1/ { proxy_pass http://127.0.0.1:7801/; }
    location = /ws/2   { proxy_pass http://127.0.0.1:7802/; }
    location ^~ /ws/2/ { proxy_pass http://127.0.0.1:7802/; }
    location = /ws/3   { proxy_pass http://127.0.0.1:7803/; }
    location ^~ /ws/3/ { proxy_pass http://127.0.0.1:7803/; }
    location = /ws/4   { proxy_pass http://127.0.0.1:7804/; }
    location ^~ /ws/4/ { proxy_pass http://127.0.0.1:7804/; }
    location = /ws/5   { proxy_pass http://127.0.0.1:7805/; }
    location ^~ /ws/5/ { proxy_pass http://127.0.0.1:7805/; }
    location = /ws/6   { proxy_pass http://127.0.0.1:7806/; }
    location ^~ /ws/6/ { proxy_pass http://127.0.0.1:7806/; }
    location = /ws/7   { proxy_pass http://127.0.0.1:7807/; }
    location ^~ /ws/7/ { proxy_pass http://127.0.0.1:7807/; }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
