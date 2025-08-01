# Use a slim Python image for small size and reliability
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies (Pillow needs libjpeg, zlib, etc)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libjpeg-dev zlib1g-dev libpng-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the Flask port
EXPOSE 5000

# Default command: run the app using start.py (which launches app.py)
CMD ["python", "start.py"]
