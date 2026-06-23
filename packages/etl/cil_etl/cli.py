import typer
from .load import ingest_dir
app = typer.Typer(help="Cricket Intelligence Lab ETL")

@app.command()
def ingest(fmt: str = typer.Option("ipl", "--format"), src: str = typer.Option(...)):
    """Ingest a directory of Cricsheet match JSON files."""
    n = ingest_dir(src)
    typer.echo(f"Ingested {n} deliveries from {src} (format={fmt}).")

if __name__ == "__main__":
    app()
