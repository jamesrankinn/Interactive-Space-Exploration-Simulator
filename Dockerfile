FROM python:3.11-slim

WORKDIR /app

# Install the Linux C++ compiler
RUN apt-get update && apt-get install -y build-essential

# Copy requirements and install Python libraries
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your backend code
COPY backend/ .

# Compile the C++ Spatial Engine for Linux
RUN pip install .

EXPOSE 5000

CMD ["python", "app.py"]