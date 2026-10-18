FROM python:3.10-slim

WORKDIR /app

# Cài đặt các công cụ biên dịch cần thiết (nếu có thư viện yêu cầu)
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

# Cài đặt các thư viện Python từ requirements.txt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Sao chép toàn bộ mã nguồn, thư mục static/ và model/ vào container
COPY . .

# Hugging Face Spaces yêu cầu mở và lắng nghe ở cổng 7860
EXPOSE 7860

# Khởi động server uvicorn trỏ vào file server.py và biến app
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]