import { spacing } from '@kshetra/design-tokens';
import {
  Button,
  ChoiceGroup,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
} from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Medal, RotateCw, Trophy, User } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorMessage, useLanguage } from '../i18n';
import { useLeaderboard, useMonth } from '../performance';

/**
 * The leaderboard on the phone (M9, BR-07), labelled indicative: the person's own group for the
 * month, ranked by score, the person marked; read online.
 */
export function LeaderboardScreen() {
  const { t, locale } = useLanguage();
  const period = useMonth();
  const [group, setGroup] = useState<string>();
  const board = useLeaderboard(period, group);
  const data = board.data;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('leaderboard.title')}
      </Text>
      <Notice>{t('copy.ranking')}</Notice>
      {board.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" role="alert">
            {errorMessage(board.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void board.refetch()}
          />
        </View>
      ) : !data ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : (
        <>
          {data.groups.length > 1 && data.group ? (
            <ChoiceGroup
              title={t('leaderboard.group')}
              choices={data.groups.map((entry) => ({
                value: entry.key,
                label: entry.name[locale].other,
              }))}
              value={data.group}
              onChange={setGroup}
            />
          ) : null}
          {data.rows.length === 0 ? (
            <EmptyState icon={Trophy} title={t('leaderboard.empty_title')}>
              {t('leaderboard.empty_body')}
            </EmptyState>
          ) : (
            <ListGroup title={t('performance.rank')}>
              {data.rows.map((row) => (
                <ListRow
                  key={row.user.id}
                  icon={row.you ? User : Medal}
                  label={
                    row.rank === null
                      ? row.user.name
                      : t('leaderboard.ranked', { rank: row.rank, name: row.user.name })
                  }
                  detail={[
                    row.score === null
                      ? t('performance.not_ranked')
                      : t('performance.score_is', { score: row.score }),
                    row.you ? t('leaderboard.you') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </ListGroup>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.space3 } });
