// Signs a planner sandbox in without its window: writes the account the way
// AccountManager keeps it (settings.ini, group [sync]) - the list of accounts
// is a QVariantList of QVariantMap, which only QSettings writes right.
//
//     seed-account <sandbox folder> <server> <login> <session key> <user id>
//
// The key comes from POST /api/login of the TEST server; the planner started
// with --data-dir <sandbox folder> opens that account and syncs at once.
#include <QCoreApplication>
#include <QSettings>
#include <QVariantMap>

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    const QStringList args = app.arguments();
    if (args.size() < 6) {
        qWarning("usage: seed-account <folder> <server> <login> <token> <userId>");
        return 2;
    }
    QSettings settings(args.at(1) + QStringLiteral("/settings.ini"), QSettings::IniFormat);
    QVariantMap record;
    record.insert(QStringLiteral("key"), args.at(3).toLower());
    record.insert(QStringLiteral("server"), args.at(2));
    record.insert(QStringLiteral("login"), args.at(3));
    record.insert(QStringLiteral("displayName"), args.at(3));
    record.insert(QStringLiteral("token"), args.at(4));
    record.insert(QStringLiteral("userId"), args.at(5));
    // The sandbox looks at the test server, never at the real one.
    settings.setValue(QStringLiteral("sync/serverAddress"), args.at(2));
    settings.setValue(QStringLiteral("sync/accounts"), QVariantList{ record });
    settings.setValue(QStringLiteral("sync/activeAccount"), args.at(3).toLower());
    settings.sync();
    return settings.status() == QSettings::NoError ? 0 : 1;
}
