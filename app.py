import os
from datetime import datetime
from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "pdf"}

db = SQLAlchemy()


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        "sqlite:///" + os.path.join(BASE_DIR, "parking.db")
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key")
    app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

    db.init_app(app)

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    with app.app_context():
        db.create_all()

    register_routes(app)
    register_cli(app)

    return app


class Neighbor(db.Model):
    __tablename__ = "neighbors"

    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(120), nullable=False)
    last_name = db.Column(db.String(120), nullable=False)
    address = db.Column(db.String(255), nullable=False)

    vehicles = db.relationship(
        "Vehicle",
        backref="owner",
        cascade="all, delete-orphan",
        lazy=True,
    )
    payments = db.relationship(
        "Payment",
        backref="neighbor",
        cascade="all, delete-orphan",
        lazy=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Neighbor {self.first_name} {self.last_name}>"


class Vehicle(db.Model):
    __tablename__ = "vehicles"

    id = db.Column(db.Integer, primary_key=True)
    license_plate = db.Column(db.String(20), nullable=False)
    make = db.Column(db.String(120), nullable=False)
    model = db.Column(db.String(120), nullable=False)
    control_number = db.Column(db.String(50), nullable=False)
    neighbor_id = db.Column(db.Integer, db.ForeignKey("neighbors.id"), nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Vehicle {self.license_plate}>"


class Payment(db.Model):
    __tablename__ = "payments"

    id = db.Column(db.Integer, primary_key=True)
    neighbor_id = db.Column(db.Integer, db.ForeignKey("neighbors.id"), nullable=False)
    method = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    deposit_account = db.Column(db.String(120))
    screenshot_path = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Payment {self.amount} {self.method}>"


def register_routes(app: Flask) -> None:
    @app.route("/")
    def home():
        neighbors = Neighbor.query.order_by(Neighbor.last_name).all()
        return render_template("index.html", neighbors=neighbors)

    # Neighbor management
    @app.route("/admin/users", methods=["GET", "POST"])
    def manage_users():
        if request.method == "POST":
            first_name = request.form.get("first_name", "").strip()
            last_name = request.form.get("last_name", "").strip()
            address = request.form.get("address", "").strip()

            if not first_name or not last_name or not address:
                flash("Todos los campos son obligatorios", "error")
            else:
                neighbor = Neighbor(
                    first_name=first_name,
                    last_name=last_name,
                    address=address,
                )
                db.session.add(neighbor)
                db.session.commit()
                flash("Vecino registrado correctamente", "success")
                return redirect(url_for("manage_users"))

        neighbors = Neighbor.query.order_by(Neighbor.last_name).all()
        return render_template("admin/users.html", neighbors=neighbors)

    @app.post("/admin/users/<int:neighbor_id>/delete")
    def delete_user(neighbor_id: int):
        neighbor = Neighbor.query.get_or_404(neighbor_id)
        db.session.delete(neighbor)
        db.session.commit()
        flash("Vecino eliminado", "success")
        return redirect(url_for("manage_users"))

    # Vehicle management
    @app.route("/admin/users/<int:neighbor_id>/vehicles", methods=["GET", "POST"])
    def manage_vehicles(neighbor_id: int):
        neighbor = Neighbor.query.get_or_404(neighbor_id)
        if request.method == "POST":
            license_plate = request.form.get("license_plate", "").strip()
            make = request.form.get("make", "").strip()
            model = request.form.get("model", "").strip()
            control_number = request.form.get("control_number", "").strip()

            if not all([license_plate, make, model, control_number]):
                flash("Todos los campos son obligatorios", "error")
            else:
                vehicle = Vehicle(
                    license_plate=license_plate,
                    make=make,
                    model=model,
                    control_number=control_number,
                    owner=neighbor,
                )
                db.session.add(vehicle)
                db.session.commit()
                flash("Vehículo agregado", "success")
                return redirect(url_for("manage_vehicles", neighbor_id=neighbor_id))

        return render_template("admin/vehicles.html", neighbor=neighbor)

    @app.post("/admin/users/<int:neighbor_id>/vehicles/<int:vehicle_id>/delete")
    def delete_vehicle(neighbor_id: int, vehicle_id: int):
        neighbor = Neighbor.query.get_or_404(neighbor_id)
        vehicle = Vehicle.query.filter_by(id=vehicle_id, neighbor_id=neighbor_id).first_or_404()
        db.session.delete(vehicle)
        db.session.commit()
        flash("Vehículo eliminado", "success")
        return redirect(url_for("manage_vehicles", neighbor_id=neighbor.id))

    # Payment management
    @app.route("/admin/users/<int:neighbor_id>/payments", methods=["GET", "POST"])
    def manage_payments(neighbor_id: int):
        neighbor = Neighbor.query.get_or_404(neighbor_id)
        if request.method == "POST":
            method = request.form.get("method", "").strip()
            amount_raw = request.form.get("amount", "").strip()
            deposit_account = request.form.get("deposit_account", "").strip() or None
            screenshot = request.files.get("screenshot")

            try:
                amount = float(amount_raw)
            except (TypeError, ValueError):
                amount = None

            if not method or amount is None:
                flash("Debe capturar el método de pago y un monto válido", "error")
            else:
                screenshot_path = None
                if screenshot and screenshot.filename:
                    if allowed_file(screenshot.filename):
                        filename = secure_filename(screenshot.filename)
                        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
                        filename = f"{timestamp}_{filename}"
                        upload_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
                        screenshot.save(upload_path)
                        screenshot_path = filename
                    else:
                        flash(
                            "Formato de archivo no permitido. Usa png, jpg, jpeg, gif o pdf.",
                            "error",
                        )
                        return redirect(url_for("manage_payments", neighbor_id=neighbor_id))

                payment = Payment(
                    neighbor=neighbor,
                    method=method,
                    amount=amount,
                    deposit_account=deposit_account,
                    screenshot_path=screenshot_path,
                )
                db.session.add(payment)
                db.session.commit()
                flash("Pago registrado", "success")
                return redirect(url_for("manage_payments", neighbor_id=neighbor_id))

        payments = (
            Payment.query.filter_by(neighbor_id=neighbor_id)
            .order_by(Payment.created_at.desc())
            .all()
        )
        return render_template(
            "admin/payments.html", neighbor=neighbor, payments=payments
        )

    @app.post("/admin/users/<int:neighbor_id>/payments/<int:payment_id>/delete")
    def delete_payment(neighbor_id: int, payment_id: int):
        payment = Payment.query.filter_by(
            id=payment_id, neighbor_id=neighbor_id
        ).first_or_404()
        if payment.screenshot_path:
            try:
                os.remove(os.path.join(app.config["UPLOAD_FOLDER"], payment.screenshot_path))
            except FileNotFoundError:
                pass
        db.session.delete(payment)
        db.session.commit()
        flash("Pago eliminado", "success")
        return redirect(url_for("manage_payments", neighbor_id=neighbor_id))

    # Public portal
    @app.route("/portal", methods=["GET", "POST"])
    def portal_search():
        neighbors = []
        query = ""
        if request.method == "POST":
            query = request.form.get("query", "").strip()
            if query:
                like_query = f"%{query}%"
                neighbors = Neighbor.query.filter(
                    db.or_(
                        Neighbor.first_name.ilike(like_query),
                        Neighbor.last_name.ilike(like_query),
                        Neighbor.address.ilike(like_query),
                    )
                ).order_by(Neighbor.last_name).all()
        return render_template("portal/search.html", neighbors=neighbors, query=query)

    @app.get("/portal/<int:neighbor_id>")
    def portal_detail(neighbor_id: int):
        neighbor = Neighbor.query.get_or_404(neighbor_id)
        payments = (
            Payment.query.filter_by(neighbor_id=neighbor_id)
            .order_by(Payment.created_at.desc())
            .all()
        )
        return render_template(
            "portal/detail.html",
            neighbor=neighbor,
            payments=payments,
        )

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename: str):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


def register_cli(app: Flask) -> None:
    @app.cli.command("init-db")
    def init_db_command():
        """Inicializa la base de datos."""
        db.create_all()
        print("Base de datos inicializada")


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
