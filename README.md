# New Structure

- `main.py`: launch entrypoint
- `chatapp/core.py`: config, db, models, schemas, helpers, gateway
- `chatapp/app.py`: FastAPI app setup and routes
- `static/index.html`: frontend markup
- `static/styles.css`: extracted styles
- `static/app.js`: extracted client logic

# Run the app 

1) Create a venv and activate it
   ```python3 -m venv venv```
   ```source venv/bin/activate```
   but also :
   ```cd .. && mkdir uploads && cd harmony```

3) Once done, install the packages
   ```pip install -r requirements.txt```

4) You are already finished, let's run the app
   ```python3 main.py```

   This will create a webui on http://0.0.0.0:8000/ and also http://localhost:8000/
   GGs! you successfuly installed Harmony !
