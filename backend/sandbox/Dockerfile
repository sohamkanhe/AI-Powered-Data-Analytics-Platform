FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if required for scipy/statsmodels/prophet
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python packages
RUN pip install --no-cache-dir \
    pandas \
    polars \
    scikit-learn \
    scipy \
    statsmodels \
    prophet \
    redis \
    pyarrow

COPY sandbox_worker.py /app/sandbox_worker.py

# Run the worker script
CMD ["python", "sandbox_worker.py"]
